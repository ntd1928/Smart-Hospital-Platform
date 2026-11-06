# Kế hoạch triển khai tuần 5–14

Mục tiêu cuối kỳ: Smart Hospital Platform chạy trên AWS với 7 module (xác thực, bệnh nhân, lịch khám, bệnh án, tài liệu y tế, trợ lý AI, vận hành cloud), kèm source code, tài liệu triển khai, báo cáo và demo. Kiến trúc nằm ở [ARCHITECTURE](architecture/ARCHITECTURE.md).

Trạng thái dưới đây ghi theo code đã merge vào `main`, không theo báo cáo tiến độ. Cập nhật bảng khi một tuần được merge và kiểm thử.

## Lộ trình

| Tuần | Nội dung                                                                 | Output                                             | Trạng thái trên `main`                    |
| ---- | ------------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| 5    | Frontend, backend, PostgreSQL, Redis, Docker; đăng nhập; khảo sát AI     | Chạy local, dashboard, tài liệu kiến trúc và AI    | Xong                                      |
| 6    | Authentication, Authorization; Patient/Practitioner FHIR; CRUD, tìm kiếm | Module tài khoản và bệnh nhân, API test            | Xong                                      |
| 7    | Appointment FHIR: đặt, sửa, hủy, theo dõi; xử lý trùng lịch              | Module lịch khám, Docker image, test nghiệp vụ     | Xong phần nhân viên; còn bệnh nhân tự đặt |
| 8    | EHR: Encounter, Condition, Observation; S3; cloud staging                | Module bệnh án, upload/download, bản staging       | Chưa bắt đầu                              |
| 9    | Pipeline tài liệu, embedding, vector search, RAG, chatbot                | AI Assistant, kết quả đánh giá ban đầu             | Mới có tài liệu khảo sát                  |
| 10   | AI đọc hồ sơ qua FHIR theo quyền; tích hợp toàn hệ thống; E2E            | Bản tích hợp đầy đủ, kết quả E2E                   | Chưa bắt đầu                              |
| 11   | AWS EC2/ECS, RDS, S3, Redis; Terraform hoặc CDK; HTTPS, secrets; backup  | Hệ thống trên AWS, cấu hình IaC, tài liệu hạ tầng  | Chưa bắt đầu                              |
| 12   | CI/CD GitHub Actions; CloudWatch; load, API, security test               | Pipeline CD, dashboard giám sát, báo cáo hiệu năng | Đã có CI; chưa có CD                      |
| 13   | Sửa lỗi, kiểm thử hồi quy, tối ưu, hoàn thiện tài liệu                   | Bản ổn định, tài liệu kỹ thuật                     | Chưa bắt đầu                              |
| 14   | Nghiệm thu, báo cáo, slide, video demo, dữ liệu mẫu                      | Bản cuối trên cloud, hồ sơ bàn giao                | Chưa bắt đầu                              |

## Chi tiết đã có (tuần 5–7)

- Đăng nhập PKCE, phiên, logout thu hồi Login; phân quyền Admin/Doctor/Patient bằng AccessPolicy upstream.
- Admin mời tài khoản, khóa/mở membership; CRUD, tìm kiếm, xóa mềm Patient; quản lý Practitioner cơ bản.
- Schedule/Slot FHIR; Admin/Doctor đặt lịch từ Slot trống và tạo Slot một lần; hủy lịch trả Slot về trống.
- Repository chặn lịch trùng giờ của cùng Practitioner, khóa theo Practitioner khi ghi, giới hạn trạng thái được hủy.
- Docker Compose toàn stack, seed idempotent, CI chạy quality + integration; unit, API và E2E test.

Còn thiếu so với kế hoạch tuần 5–7: bệnh nhân tự đặt lịch, lịch lặp cho Schedule, giới hạn Doctor theo bệnh nhân được phân công, giao diện quản lý bác sĩ đầy đủ.

## Tuần 8: việc cần làm

1. Mở Encounter, Condition, Observation trong `SUPPORTED_FHIR_RESOURCES`; kiểm tra quyền Doctor/Patient bằng API test.
2. Giao diện bác sĩ ghi lần khám, chẩn đoán, kết quả; màn hình lịch sử bệnh án cho Doctor và Patient.
3. Liên kết Encounter với Appointment đã khám.
4. Lưu tài liệu lên S3: chọn resource FHIR cho metadata, API cấp URL có thời hạn, kiểm tra quyền trước khi cấp.
5. Dựng môi trường staging đầu tiên; ghi cách dựng vào `docs/development`.
6. Cập nhật [API](architecture/API.md), [ARCHITECTURE](architecture/ARCHITECTURE.md), [CONTEXT](development/CONTEXT.md) và bảng lộ trình.

## Tiêu chí nghiệm thu

| Mốc           | Tuần | Điều kiện đạt                                                                                                  |
| ------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| Nghiệp vụ lõi | 8    | Lịch khám, bệnh án, tài liệu chạy trên staging; API test và test phân quyền đạt                                |
| Tích hợp AI   | 10   | Trả lời có trích dẫn; đánh giá trên ít nhất 20 câu hỏi; tỉ lệ lộ dữ liệu trái quyền bằng 0; E2E toàn luồng đạt |
| Chạy trên AWS | 12   | Hạ tầng dựng bằng IaC; CD, giám sát, backup/restore đã chạy thử; có báo cáo load và security test              |
| Nghiệm thu    | 14   | Demo trên cloud, source code, tài liệu triển khai, báo cáo, slide, video                                       |

Mỗi mốc chỉ ghi đạt khi có kết quả chạy thật; CI hosted ghi riêng với chạy local.

## Rủi ro và phụ thuộc

| Rủi ro                                    | Giảm thiểu                                                         |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Báo cáo tiến độ đi trước code trên `main` | Merge theo tuần; cập nhật cột trạng thái ở bảng lộ trình khi merge |
| AI cần dữ liệu bệnh án tuần 8             | Hoàn thành EHR trước khi nối AI vào hồ sơ ở tuần 10                |
| AI trả lời sai hoặc lộ hồ sơ trái quyền   | Bắt buộc trích dẫn, báo thiếu nguồn, câu hỏi kiểm thử trái quyền   |
| Chi phí AWS và LLM API                    | Budget alert, tắt staging khi không dùng, cân nhắc model local     |
| Tuần 11–12 thiếu thời gian                | Tái dùng Docker image và CI hiện có; ưu tiên hạng mục bắt buộc     |
