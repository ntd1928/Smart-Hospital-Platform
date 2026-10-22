# Chạy toàn bộ hệ thống bằng Docker

## Yêu cầu và khởi động

Docker Engine/Desktop, Compose v2 và Internet cho lần build đầu. Với WSL dùng đúng một Docker daemon, bật Desktop integration hoặc chạy Engine trong WSL. Không cần Node/npm trên host để demo. Cổng 3000 và 8103 phải rảnh. Database/cache chỉ ở mạng Docker, không publish 5432/6379 trong chế độ demo. Khi chạy source, `npm run services:up` dùng thêm docker-compose.dev.yml để publish hai cổng đó; dừng server/web container trước khi chuyển sang API/Vite trên host.

Dừng API/Vite chạy source bằng Ctrl+C; không dừng tùy tiện tiến trình khác. Tại thư mục repo:

```bash
docker compose up --build -d --wait --wait-timeout 600
docker compose ps -a
curl http://localhost:8103/healthcheck
```

Web http://localhost:3000. Seed Exited (0) là đúng; server/web/postgres/redis phải healthy. Lệnh chỉ hoàn tất khi stack sẵn sàng hoặc báo lỗi/timeout. Trên máy chậm có thể tăng wait-timeout; quá trình build không nằm trong thời gian chờ health này.

## Container và dữ liệu

| Service  | Chức năng                                                            | Lưu dữ liệu                                        |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| postgres | FHIR resource/history/lookup, tài khoản và membership                | postgres-data                                      |
| redis    | Cache/auth, AOF                                                      | redis-data                                         |
| seed     | Migration/definitions và dữ liệu demo trước API; chạy bằng user node | demo-data chứa .runtime/demo.json                  |
| server   | API Node đã build, không dùng tsx watch; user node                   | binary-data cho storage nội bộ, chưa có upload API |
| web      | Nginx phục vụ React SPA, hỗ trợ reload URL sâu                       | Không lưu dữ liệu người dùng                       |

Database/cache kết nối từ container bằng tên `postgres`/`redis`, không dùng localhost. Browser trên host gọi API localhost:8103; CORS và URL đăng nhập dành cho localhost:3000. Đây là local demo, chưa phải cấu hình production/LAN/HTTPS. `.dockerignore` dùng allowlist, không gửi .git/.local/.runtime/.env, database hay node_modules trên host vào build context.

Seed là công cụ demo riêng, giữ source/tsx để tạo và kiểm tra dữ liệu. API runtime loại devDependencies, chỉ chạy JavaScript đã build. Không dùng seed hoặc mật khẩu mặc định với dữ liệu thật. Tài khoản demo ở README. Mật khẩu PostgreSQL/Redis/DEMO_PASSWORD có thể lấy từ `.env` qua Compose; đổi mật khẩu tài khoản/DB đã tồn tại cần quy trình riêng, không chỉ sửa `.env` rồi chạy lại seed.

## Dừng, chạy lại và sửa code

```bash
docker compose stop
docker compose up --build -d --wait --wait-timeout 600
```

Giữ nguyên tên project `smart-hospital`, Docker daemon/context và volume khi chuyển từ chế độ source cũ để tái sử dụng dữ liệu. Docker Desktop và Engine trong WSL có kho image/volume riêng dù tên project giống nhau; đổi daemon không tự chuyển dữ liệu, có thể tạo database demo mới. Kiểm tra `docker context ls` và `docker info` trước khi chạy, không tự xóa/migrate volume cũ. Không xóa volume, không dùng `docker compose down -v` để sửa lỗi khởi động. `down` không có -v giữ dữ liệu nhưng xóa container/network; lần up sau tạo lại container và seed idempotent. Sửa code cần rebuild; không có hot reload trong chế độ demo.

## Kiểm thử trên container

API test chạy trong image seed, gọi server qua network Compose, dùng fixture cùng database:

```bash
docker compose run --rm --no-deps -e MEDPLUM_BASE_URL=http://server:8103/ seed npm run test:api
```

Browser test cần Node/npm đúng README trên host (chỉ cho người chạy test, không phải người demo). Đồng bộ đúng fixture từ container, không dùng fixture của database khác:

```bash
mkdir -p .runtime
docker compose cp seed:/app/.runtime/demo.json .runtime/demo.json
npm ci
npx playwright install chromium
E2E_EXTERNAL_SERVER=1 npm run test:e2e
```

E2E_EXTERNAL_SERVER bỏ Vite do Playwright tự khởi động, kiểm thử trực tiếp SPA Nginx ở localhost:3000, kể cả reload URL sâu. Để kiểm tra đầy đủ code/config local khi stack Docker chạy: `E2E_EXTERNAL_SERVER=1 npm run verify`. API/E2E thay đổi dữ liệu demo tạm thời rồi dọn; không chạy vào môi trường thật hoặc cùng lúc nhiều bộ test trên cùng database.

`test:persistence` cũ dành cho chế độ source: dừng toàn bộ server/web trước khi restart PostgreSQL/Redis, đồng bộ fixture trước khi chạy. Không chạy đồng thời API đang phục vụ để tránh connection pool mất kết nối. Có thể trình diễn persistence đơn giản bằng cách tạo Patient trên UI, stop rồi up stack, đăng nhập và tìm lại hồ sơ; không xóa volume.

## Chẩn đoán

```bash
docker compose logs --tail=80 seed
docker compose logs --tail=80 server web
docker compose ps -a
```

- Port already allocated: kiểm tra API/Vite hoặc stack khác đang giữ cổng; dừng đúng tiến trình. Không chạy đồng thời hai chế độ.
- Seed exit khác 0: xem log trước khi retry; API cố ý chưa khởi động khi seed lỗi.
- API healthy nhưng login lỗi: kiểm tra tài khoản/mật khẩu seed ban đầu, dùng localhost chứ không dùng IP LAN; logout hoặc cửa sổ riêng tư nếu đang giữ phiên của database cũ.
- Database authentication failed sau đổi password: volume cũ vẫn giữ mật khẩu cũ. Khôi phục cấu hình phù hợp hoặc đổi mật khẩu có kiểm soát; không xóa dữ liệu để chữa lỗi.
- Docker không truy cập được registry/npm: kiểm tra mạng/daemon/proxy. Build lỗi không đồng nghĩa code đã được kiểm chứng trong container.

## Kết quả kiểm chứng local

Ngày 22/10/2026, trên Docker Desktop Engine 28.5.1 / Compose v2.40.2, Node container 22.22.0:

- Build cả ba image, khởi tạo database mới từ migration v1–v122, seed thành công; bốn dịch vụ healthy.
- Nginx kiểm tra cấu hình đạt; URL sâu /dashboard trả SPA. API chạy uid 1000, không có source src, tsx, .env hoặc .local trong runtime image.
- API test từ container: 18 nhóm đạt. `E2E_EXTERNAL_SERVER=1 npm run verify` đạt typecheck, lint, format, 3 unit, build, 18 API và 4 browser scenario trên Nginx/API container.
- Stop/up cả stack: giữ nguyên nội dung hồ sơ thử, ID bộ seed và khóa Redis AOF. Đã xóa mềm đúng hồ sơ thử và xóa khóa Redis thử; không xóa dữ liệu seed hoặc volume. Tài khoản được đăng nhập lại sau restart.
- Compose demo/dev hợp lệ, actionlint đạt. Kết quả local không chứng minh hosted CI hoặc cloud deployment đã đạt.

Máy đã chuyển từ Engine WSL sang Docker Desktop trong đợt kiểm tra; database demo Desktop được tạo mới. Volume cũ thuộc Engine WSL không bị xóa hoặc tự migrate.

Quy tắc startup dựa trên [depends_on và healthcheck của Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/).
