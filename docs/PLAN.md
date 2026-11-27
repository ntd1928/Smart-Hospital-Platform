# Kế hoạch triển khai tuần 5–14

Mục tiêu cuối kỳ: Smart Hospital Platform chạy trên AWS với 7 module (xác thực, bệnh nhân, lịch khám, bệnh án, tài liệu y tế, trợ lý AI, vận hành cloud), kèm source code, tài liệu triển khai, báo cáo và demo. Kiến trúc nằm ở [ARCHITECTURE](architecture/ARCHITECTURE.md).

Trạng thái dưới đây ghi theo code đã merge vào `main`, không theo báo cáo tiến độ. Phân biệt code, kiểm tra và deploy; không gọi là hoàn tất nếu chưa có bằng chứng tương ứng.

## Lộ trình

| Tuần | Nội dung                                                                 | Output                                             | Trạng thái trên `main`                    |
| ---- | ------------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| 5    | Frontend, backend, PostgreSQL, Redis, Docker; đăng nhập; khảo sát AI     | Chạy local, dashboard, tài liệu kiến trúc và AI    | Xong                                      |
| 6    | Authentication, Authorization; Patient/Practitioner FHIR; CRUD, tìm kiếm | Module tài khoản và bệnh nhân, API test            | Xong                                      |
| 7    | Appointment FHIR: đặt, sửa, hủy, theo dõi; xử lý trùng lịch              | Module lịch khám, Docker image, test nghiệp vụ     | Đã có booking Patient, lịch lặp và kiểm tra trùng; còn ngoại lệ/ngày lễ |
| 8    | EHR: Encounter, Condition, Observation; S3; cloud staging                | Module bệnh án, upload/download, bản staging       | EHR nền tảng và S3 Binary API đã có; giao diện tài liệu/staging chưa có |
| 9    | Pipeline tài liệu, embedding, vector search, RAG, chatbot                | AI Assistant, kết quả đánh giá ban đầu             | Mới có tài liệu khảo sát                  |
| 10   | AI đọc hồ sơ qua FHIR theo quyền; tích hợp toàn hệ thống; E2E            | Bản tích hợp đầy đủ, kết quả E2E                   | EHR tích hợp nền tảng; AI và E2E chưa có   |
| 11   | AWS EC2/ECS, RDS, S3, Redis; Terraform hoặc CDK; HTTPS, secrets; backup  | Hệ thống trên AWS, cấu hình IaC, tài liệu hạ tầng  | CDK staging và S3 Binary đã có; chưa deploy hoặc thử restore |
| 12   | CI/CD GitHub Actions; CloudWatch; load, API, security test               | Pipeline CD, dashboard giám sát, báo cáo hiệu năng | Có CI và CloudWatch IaC cơ bản; CD/dashboard/test tải còn thiếu |
| 13   | Sửa lỗi, kiểm thử hồi quy, tối ưu, hoàn thiện tài liệu                   | Bản ổn định, tài liệu kỹ thuật                     | Chưa bắt đầu                              |
| 14   | Nghiệm thu, báo cáo, slide, video demo, dữ liệu mẫu                      | Bản cuối trên cloud, hồ sơ bàn giao                | Chưa bắt đầu                              |

## Chi tiết đã có (tuần 5–11)

- Đăng nhập PKCE, phiên, logout thu hồi Login; phân quyền Admin/Doctor/Patient bằng AccessPolicy upstream.
- Admin mời tài khoản, khóa/mở membership; CRUD, tìm kiếm, xóa mềm Patient; quản lý Practitioner cơ bản.
- Schedule/Slot FHIR; Patient đặt/hủy/đổi lịch cơ bản; staff tạo Slot một lần và lịch lặp; có waitlist date preference và các thao tác hủy/đổi series.
- Repository chặn lịch trùng theo Practitioner, Slot/Schedule validation, khóa ghi đồng thời và giới hạn hủy.
- Encounter, Condition, Observation, MedicationRequest, MedicationStatement, MedicationAdministration và AllergyIntolerance có API/lifecycle nền tảng; EHR page hỗ trợ ghi và Patient đọc lịch sử.
- AWS CDK khai báo ECS/Fargate, RDS, Redis, S3, HTTPS/DNS, Secrets Manager, backup cơ bản và CloudWatch; S3 Binary storage nối vào API task role.
- Docker Compose chạy local; CI có quality và integration workflow. AWS stack chưa deploy; lần làm việc này không chạy test.

Phần còn thiếu: xử lý ngoại lệ/ngày lễ cho lịch lặp, giao diện quản lý tài liệu, AI runtime, cloud deployment, restore drill và CD/monitoring vận hành.

## Tuần 8: trạng thái và phần còn lại

1. Encounter, Condition và Observation đã mở qua FHIR API; EHR UI hỗ trợ ghi/đọc cơ bản. Vòng đời lâm sàng đầy đủ vẫn còn thiếu.
2. Encounter có thể liên kết Appointment đã hoàn tất; Doctor ghi và Patient đọc theo policy/compartment.
3. S3 Binary backend/API và bucket staging được khai báo; giao diện tài liệu chưa có.
4. AWS staging IaC và hướng dẫn nằm ở `infra/aws`; stack chưa deploy và chưa có kết quả restore thật.
5. [API](architecture/API.md), [ARCHITECTURE](architecture/ARCHITECTURE.md), [CONTEXT](development/CONTEXT.md) và hướng dẫn AWS đã cập nhật.

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
