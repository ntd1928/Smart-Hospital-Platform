# Demo nền tảng Smart Hospital — 10–15 phút

## 1. Chuẩn bị trước buổi báo cáo

Tại thư mục repo, dừng API/Vite chạy source rồi chạy:

```bash
docker compose up --build -d --wait --wait-timeout 600
docker compose ps -a
curl http://localhost:8103/healthcheck
```

Bốn service postgres/redis/server/web healthy, seed Exited (0). Tải image/build lần đầu trước buổi trình bày; không chờ đến lúc demo mới tải. Mở http://localhost:3000, nên dùng cửa sổ riêng tư. Chỉ dữ liệu giả lập, không dùng hồ sơ thật.

Mật khẩu mặc định cho các tài khoản dưới đây: `HospitalDemo!2026` (nếu người seed chưa thay đổi).

| Vai trò | Email                  |
| ------- | ---------------------- |
| Admin   | admin@hospital.test    |
| Doctor  | doctor1@hospital.test  |
| Patient | patient1@hospital.test |

## 2. Chứng minh kiến trúc đang chạy — 2 phút

Hiển thị `docker compose ps -a`: Nginx phục vụ React SPA, backend Node, PostgreSQL và Redis, seed đã hoàn tất. Mở healthcheck, giải thích postgres/redis=true. Đối chiếu sơ đồ [kiến trúc](../architecture/ARCHITECTURE.md).

Nêu rõ: container chạy trên máy cá nhân vẫn là local; chưa có AWS/staging. FHIR là cách biểu diễn/truy cập dữ liệu y tế; PostgreSQL là nơi lưu dữ liệu. Redis hỗ trợ cache/auth, không thay database.

## 3. Admin — 4 phút

1. Đăng nhập Admin, mở dashboard. Dữ liệu seed ban đầu gồm 10 Patient, 4 Appointment; Practitioner gồm 2 Doctor và profile Admin. Số lượng có thể thay đổi sau thao tác demo.
2. Vào Bệnh nhân → Thêm bệnh nhân, dùng tên dễ tìm như `Demo Bao Cao`, ngày sinh/giới tính/điện thoại giả. Lưu → mở chi tiết → sửa điện thoại → tìm lại theo tên.
3. Vào Bác sĩ, mở một Practitioner. Giải thích User là tài khoản, Patient/Practitioner là hồ sơ, ProjectMembership nối tài khoản với project/quyền.
4. Vào Người dùng, tạo một Patient account với email `demo-report@hospital.test` và mật khẩu giả. Khóa/mở account. Nếu demo lại, dùng email mới hoặc kiểm tra tài khoản cũ, không tạo trùng.
5. Có thể mở DevTools → Network, lọc `fhir/R4` để chứng minh UI gọi backend thật. Không chiếu Authorization header/token.

## 4. Doctor và Patient — 3 phút

1. Đăng xuất, vào Doctor: dashboard bác sĩ, danh sách bệnh nhân; không có menu quản trị user. Mở trực tiếp http://localhost:3000/users để thấy bị chặn. Reload dashboard vẫn giữ phiên.
2. Đăng xuất, vào Patient: chỉ thấy hồ sơ cá nhân. Muốn kiểm chứng truy cập chéo, trước đó sao chép URL chi tiết một bệnh nhân khác khi đang ở Admin; mở URL đó sau khi vào Patient. Kết quả phải báo không có quyền/không tìm thấy, không hiện dữ liệu người khác.
3. Logout rồi truy cập dashboard để thấy quay lại login. Backend thực thi quyền; ẩn menu chỉ là trải nghiệm UI.

## 5. Kiểm thử và dữ liệu bền vững — 2–3 phút

```bash
docker compose run --rm --no-deps -e MEDPLUM_BASE_URL=http://server:8103/ seed npm run test:api
```

Giải thích các nhóm kiểm tra: CRUD Patient/Practitioner/Appointment cơ bản, token sai, dữ liệu FHIR sai, quyền quản trị, compartment, project isolation, refresh và logout. Lệnh chạy trong container, không cần Node trên host. Browser test theo [DOCKER](../development/DOCKER.md); có thể chuẩn bị kết quả trước buổi báo cáo.

Nếu đủ thời gian: tạo một Patient có tên riêng, chạy `docker compose stop` rồi `docker compose up -d --wait --wait-timeout 600`, đăng nhập và tìm lại hồ sơ. Việc giữ dữ liệu nhờ volume, không phải rebuild frontend. Không dùng down -v. Kết thúc demo có thể xóa mềm đúng hồ sơ thử đã tạo; không xóa bộ seed.

## 6. Kết luận đúng phạm vi — 1 phút

Đã có auth/session, phân quyền cơ bản, dashboard, Patient Management, quản lý tài khoản/bác sĩ cơ bản, Appointment API cơ bản và môi trường Docker. AI mới có khảo sát LLM/RAG; chưa có chatbot chạy thật. Chưa có workflow đặt khám/chống trùng lịch, lịch sử khám EHR, S3/cloud hoặc monitoring. Resource version history không phải lịch sử khám bệnh.

Auth/FHIR/repository kế thừa Medplum; phần tích hợp, giao diện, cấu hình, dữ liệu và kiểm thử được tổ chức cho đồ án. CI chỉ tuyên bố đạt trên GitHub khi có hosted run thực tế, không dùng kết quả local làm bằng chứng cho cloud.
