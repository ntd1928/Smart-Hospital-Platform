# Kế hoạch tuần 5–6

Mục tiêu: tách phần Medplum cần cho báo cáo tuần 5–6, phát triển Smart Hospital Platform trong repo riêng và kiểm chứng bằng hệ thống chạy thật. Không nhập toàn bộ monorepo hoặc chức năng cho các tuần tiếp theo.

## Cổng nghiệm thu

1. Source được tách theo dependency từ auth, repository PostgreSQL, FHIR CRUD và quản trị người dùng; giữ license, nguồn và manifest file.
2. PostgreSQL và Redis có Docker Compose, volume, healthcheck; backend/app chạy từ source. Restart giữ dữ liệu.
3. Admin, Doctor, Patient đăng nhập, duy trì phiên, đăng xuất; backend chặn thao tác và dữ liệu trái quyền.
4. Dashboard ba vai trò; giao diện danh sách, tìm kiếm, thêm, xem, sửa, xóa mềm bệnh nhân; quản lý bác sĩ và tài khoản cơ bản.
5. Patient/Practitioner theo FHIR; Appointment chỉ CRUD/API cơ bản, không triển khai quy trình đặt khám tuần 7.
6. Seed idempotent với 1 Admin, 2 Doctor, 10 Patient (ít nhất 2 tài khoản), Appointment; project phụ phục vụ test isolation.
7. Build/typecheck/unit test/API integration/Playwright và audit từng đầu mục báo cáo. Kết quả chỉ được ghi đạt khi đã chạy.
8. Tài liệu kiến trúc, khảo sát LLM/RAG có nguồn, context/plan/tracking/handoff cho nhóm 4 người.
9. Rà soát license, secrets, diff, test và comment; bàn giao local theo công việc thực tế. Theo yêu cầu mới nhất: chưa push GitHub.

## Thứ tự và giới hạn

Tách dependency → dựng môi trường → auth/seed → giao diện → test → sửa → audit → bàn giao local. Lặp test/audit đến khi đạt hoặc xác định blocker môi trường cần người dùng xử lý. Chỉ push khi người dùng yêu cầu lại.

Giữ chính sách mặc định Medplum: Admin là project-admin; Doctor là Practitioner; Patient giới hạn compartment cá nhân. Không tự đặt luật bác sĩ được phân công. Dashboard dùng API thật và công cụ UI Medplum. Tài liệu AI là nghiên cứu, không có chatbot giả.

## Lộ trình tiếp theo

Tuần 7: quy trình lịch khám và trùng lịch. Tuần 8: EHR và S3/staging. Tuần 9: RAG/chat. Tuần 10: AI theo quyền và E2E tích hợp. Tuần 11: AWS/IaC. Tuần 12: CI/CD/monitoring/load test. Tuần 13: hồi quy/tối ưu. Tuần 14: nghiệm thu/bàn giao.
