# Smart Hospital Platform

Nền tảng quản lý bệnh viện cho ba nhóm người dùng Admin, Doctor và Patient, xây dựng trong khuôn khổ môn **Phát triển ứng dụng điện toán đám mây**. Phiên bản hiện tại tập trung vào đăng nhập, phân quyền, quản lý tài khoản và hồ sơ bệnh nhân trên FHIR API.

Frontend React/TypeScript kết nối backend Node.js, PostgreSQL và Redis. Các dịch vụ dữ liệu chạy bằng Docker Compose; GitHub Actions kiểm tra chất lượng, build và kiểm thử tích hợp. Chưa triển khai lên cloud.

## Chạy local

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
- Appointment API cơ bản; Docker PostgreSQL/Redis; unit/API/E2E và tài liệu khảo sát LLM/RAG.

Chưa có workflow lịch khám/chống trùng lịch, EHR/lịch sử khám, S3, chatbot hoạt động hoặc cloud. Schema/definitions dùng chung không chứng minh các module đó đã triển khai.

## Kiểm thử

Khi API/dịch vụ đã chạy và seed hoàn tất:

```bash
npx playwright install chromium
npm run verify
```

Verify chạy typecheck (cả seed/test), lint mã nhóm, format check, unit test, build, API integration và E2E. API test tạo/xóa dữ liệu tạm và kiểm tra quyền trực tiếp. E2E tự chạy Vite nếu cổng 3000 chưa được dùng. Chỉ chạy integration với database demo local.

## Dừng dịch vụ và giữ dữ liệu

```bash
npm run services:down
```

Lệnh dừng container, giữ volume. API/web dừng bằng Ctrl+C. Không dùng docker compose down -v nếu cần giữ dữ liệu. Nếu đổi cổng/mật khẩu Compose, export MEDPLUM_DATABASE_* và MEDPLUM_REDIS_* tương ứng cho API và seed; .env Compose không tự export vào Node. Xem [.env.example](.env.example).

Để kiểm chứng dữ liệu qua restart, dừng API trước rồi chạy `npm run test:persistence`: script restart đúng PostgreSQL/Redis của Compose này và so sánh hồ sơ cùng một khóa thử Redis trước/sau; không xóa volume. Sau đó khởi động lại API. Nếu WSL không dùng systemd và Engine chưa chạy, có thể mở terminal riêng chạy `sudo dockerd` trước khi chạy Compose.

## Tài liệu

- [Kiến trúc](docs/architecture/ARCHITECTURE.md) và [API](docs/architecture/API.md).
- [Context kỹ thuật](docs/development/CONTEXT.md), [đóng góp](CONTRIBUTING.md) và [CI](docs/development/CI.md).
- [Phân loại tài liệu](docs/development/DOCUMENTATION.md), [AI research](docs/research/AI-RESEARCH.md) và [demo](docs/reports/DEMO.md).
- [AGENTS.md](AGENTS.md): quy tắc cho coding agent.
