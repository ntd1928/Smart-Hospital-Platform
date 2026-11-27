# Smart Hospital Platform

Nền tảng quản lý bệnh viện cho ba nhóm người dùng Admin, Doctor và Patient, xây dựng trong khuôn khổ môn **Phát triển ứng dụng điện toán đám mây**. Phiên bản hiện tại hỗ trợ đăng nhập, phân quyền, quản lý hồ sơ, lịch Appointment/Schedule/Slot và hồ sơ lâm sàng cơ bản trên FHIR API.

Frontend React/TypeScript kết nối backend Node.js, PostgreSQL và Redis. Toàn bộ ứng dụng có thể chạy bằng Docker Compose; GitHub Actions được cấu hình kiểm tra chất lượng, build và kiểm thử tích hợp. Chưa triển khai lên cloud.

## Chạy demo bằng Docker — khuyến nghị

Chỉ cần Docker Engine/Desktop và Compose v2 đang chạy; không cần cài Node/npm trên máy. Dừng API/Vite chạy source nếu đang chiếm cổng 8103/3000, rồi chạy tại thư mục repo:

```bash
docker compose up --build -d --wait --wait-timeout 600
docker compose ps -a
```

Compose chạy PostgreSQL, Redis, seed dữ liệu một lần cho mỗi đợt khởi động, API Node và frontend Nginx. `seed` thoát mã 0 là bình thường; bốn dịch vụ còn lại cần healthy. Lần đầu tải image, dependency và khởi tạo FHIR có thể mất vài phút. Seed idempotent: chạy lại không nhân bản bộ demo, không xóa dữ liệu đã sửa.

Mở http://localhost:3000; API http://localhost:8103/healthcheck phải có ok/postgres/redis bằng true. Frontend dùng bản build, không phải Vite dev server. Docker vẫn chạy local, chưa phải cloud. Chỉ hỗ trợ trình duyệt trên chính máy này với các cổng mặc định; chưa cấu hình HTTPS hoặc truy cập LAN.

```bash
docker compose logs --tail=50 seed server web
docker compose stop
```

`stop` giữ container và volume. Dùng lại lệnh `up` ở trên để chạy tiếp. Không dùng `down -v` nếu cần giữ dữ liệu. Khi sửa code, chạy lại `up --build` để cập nhật image. Xem [hướng dẫn Docker](docs/development/DOCKER.md) và [demo 10–15 phút](docs/reports/DEMO.md).

## AWS staging infrastructure

`infra/aws` chứa AWS CDK cho VPC, ECS/Fargate, PostgreSQL RDS, Redis, HTTPS, Route 53, CloudWatch và S3 Binary storage. API ECS dùng task role giới hạn vào prefix `binary/*`; cấu hình local/Docker vẫn lưu Binary trên filesystem. Cấu hình deploy, backup/restore, chi phí và giới hạn nằm trong [hướng dẫn AWS](infra/aws/README.md). Hạ tầng chưa được deploy và chưa có CI/CD hosted.

## Chạy source để phát triển — tùy chọn

Yêu cầu: Node.js theo .nvmrc (22.22.0), npm 11.21.1, Docker Engine/Desktop và Compose v2 đang hoạt động. Với WSL, bật Desktop integration hoặc dùng Engine trong WSL; không cần chạy hai daemon cùng lúc.

```bash
nvm install
nvm use
npm install -g npm@11.21.1
npm ci
npm run services:up
npm run build
npm run seed
```

Lần đầu migration/seed FHIR definitions có thể mất vài phút. Sau đó mở hai terminal:

Nếu chưa có nvm nhưng máy có Node/npm cũ, có thể dùng launcher cho từng lệnh, ví dụ `npx --yes --package=node@22.22.0 --package=npm@11.21.1 -- npm ci`, rồi thay phần cuối bằng `npm run seed` hoặc `npm run dev:server`. Launcher dùng cache npm sau lần tải đầu; không cần đổi Node toàn hệ thống.

```bash
# Terminal 1
npm run dev:server
```

```bash
# Terminal 2
npm run dev:app
```

Web: http://localhost:3000 · API: http://localhost:8103 · health: http://localhost:8103/healthcheck. Các trường postgres/redis phải true. Seed lại không nhân bản bộ demo; ID local ở .runtime/demo.json không đưa lên Git.

## Tài khoản demo local

| Vai trò | Email                                           |
| ------- | ----------------------------------------------- |
| Admin   | admin@hospital.test                             |
| Doctor  | doctor1@hospital.test / doctor2@hospital.test   |
| Patient | patient1@hospital.test / patient2@hospital.test |

Mật khẩu mặc định: `HospitalDemo!2026`. Có thể export DEMO_PASSWORD trước seed lần đầu; chạy lại không đổi mật khẩu tài khoản đã có. Dữ liệu giả lập: 10 Patient, 2 tài khoản Doctor, 4 Appointment và project phụ kiểm thử isolation. Admin có profile Practitioner riêng nên số Practitioner gồm cả Admin.

Backend bootstrap còn có tài khoản super-admin upstream; không dùng tài khoản đó để demo nghiệp vụ. Có thể ghi đè MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL và MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD trước lần tạo database đầu tiên. Cấu hình hiện tại chỉ dành cho localhost.

## Phạm vi

- Đăng nhập/logout/phiên và phân quyền bằng backend thật; dashboard ba vai trò dùng FHIR API.
- Danh sách, tìm kiếm, thêm, xem, sửa, xóa mềm Patient; quản lý Practitioner cơ bản.
- Admin tạo tài khoản local, khóa/mở membership; Patient giới hạn compartment của mình.
- Appointment/Schedule/Slot có kiểm tra trùng lịch; EHR nền tảng với các resource lâm sàng chính.
- Docker PostgreSQL/Redis, unit/API/E2E và AWS CDK staging baseline.

Chưa có EHR lifecycle đầy đủ, giao diện upload/download tài liệu, AI assistant runtime hoặc môi trường cloud đã triển khai. FHIR Binary API có thể lưu payload trong S3 khi chạy trên stack AWS; local và Docker tiếp tục dùng filesystem.

## Kiểm thử

Với chế độ source, khi API/dịch vụ đã chạy và seed hoàn tất:

```bash
npx playwright install chromium
npm run verify
```

Verify chạy typecheck (cả seed/test), lint mã nhóm, format check, unit test, build, API integration, E2E và AWS CDK typecheck/template/synthesis. API test tạo/xóa dữ liệu tạm và kiểm tra quyền trực tiếp. E2E tự chạy Vite nếu cổng 3000 chưa được dùng. Chỉ chạy integration với database demo local.

Với stack Docker đang chạy, kiểm tra API không cần Node trên host:

```bash
docker compose run --rm --no-deps -e MEDPLUM_BASE_URL=http://server:8103/ seed npm run test:api
```

Cách chạy browser test lên bản Nginx và đồng bộ fixture nằm trong [DOCKER.md](docs/development/DOCKER.md).

## Dừng dịch vụ và giữ dữ liệu

```bash
npm run services:down
```

Lệnh dừng container, giữ volume. API/web dừng bằng Ctrl+C. Không dùng docker compose down -v nếu cần giữ dữ liệu. Nếu đổi cổng/mật khẩu Compose, export MEDPLUM_DATABASE_* và MEDPLUM_REDIS_* tương ứng cho API và seed; .env Compose không tự export vào Node. Xem [.env.example](.env.example).

`npm run test:persistence` dành riêng cho chế độ source với database/cache được publish bằng Compose dev: dừng API trước, dùng fixture đúng database rồi chạy script; không xóa volume. Sau đó khởi động lại API. Với demo toàn Docker, dùng quy trình stop/up và kiểm tra hồ sơ tại [DOCKER.md](docs/development/DOCKER.md), không chạy script source vào database khác. Nếu WSL không dùng systemd và Engine chưa chạy, có thể mở terminal riêng chạy `sudo dockerd`; không khởi động thêm Engine khi đã dùng Docker Desktop integration.

## Tài liệu

- [Kiến trúc](docs/architecture/ARCHITECTURE.md), [API](docs/architecture/API.md) và [kế hoạch tuần 5–14](docs/PLAN.md).
- [Context kỹ thuật](docs/development/CONTEXT.md), [đóng góp](CONTRIBUTING.md) và [CI](docs/development/CI.md).
- [Phân loại tài liệu](docs/development/DOCUMENTATION.md), [AI research](docs/research/AI-RESEARCH.md) và [demo](docs/reports/DEMO.md).
- [AGENTS.md](AGENTS.md): quy tắc cho coding agent.
