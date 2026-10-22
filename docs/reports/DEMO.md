## Chuẩn bị

Theo README: Node/npm đúng phiên bản → npm ci → npm run services:up → npm run seed → chạy API/web. Healthcheck phải có postgres và redis true. Tài khoản/mật khẩu demo ở README. Chỉ sử dụng dữ liệu giả lập.

## Demo trực tiếp

1. Admin đăng nhập, xem dashboard và giải thích dữ liệu lấy từ FHIR API. Mở Docker Compose để chứng minh PostgreSQL/Redis đang chạy.
2. Mở danh sách bệnh nhân, tìm theo tên, tạo một hồ sơ với họ/tên/ngày sinh/giới tính. Vào chi tiết, sửa điện thoại, quay lại danh sách tìm hồ sơ vừa tạo.
3. Mở danh sách bác sĩ và chi tiết Practitioner. Nêu khác biệt hồ sơ Patient/Practitioner với User và ProjectMembership.
4. Admin vào Người dùng, tạo Patient account local, kiểm tra role, khóa/mở membership. Không gửi email ngoài hệ thống trong demo.
5. Đăng xuất và đăng nhập Doctor: có dashboard/danh sách bệnh nhân; không có menu quản trị. Gõ trực tiếp /users để thấy bị chặn.
6. Đăng nhập patient1: thấy dashboard và hồ sơ cá nhân. Dùng ID patient2 trong .runtime/demo.json mở URL khác: backend từ chối, không hiển thị thông tin người khác.
7. Trình bày npm run test:api: token sai, CRUD, dữ liệu sai, truy cập chéo, project isolation, khóa tài khoản, refresh và logout. Có thể mở Playwright report sau npm run test:e2e.
8. Chỉ ra Appointment API và dữ liệu mẫu, tài liệu khảo sát AI, kiến trúc và tracking nhóm. Phân biệt rõ đây là đầu ra tuần 5–6, chưa có workflow đặt khám, EHR, cloud hoặc chatbot chạy thật.

## Lưu ý khi thuyết trình

Ghi rõ nền tảng auth/FHIR/repository được kế thừa Medplum; nhóm thực hiện việc tách phạm vi, tích hợp, cấu hình project/quyền, giao diện, dữ liệu và kiểm chứng. Thời điểm hoàn thiện được ghi theo thực tế. Lịch sử phiên bản dữ liệu FHIR không phải lịch sử khám bệnh.
