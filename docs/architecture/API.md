# API và luồng lịch hẹn cơ bản

Base URL `http://localhost:8103`; API bảo vệ dùng Authorization: Bearer token. Content-Type JSON FHIR: application/fhir+json. Frontend dùng SDK quản lý PKCE/token, không tự chèn token vào URL.

| API                                           | Mục đích                                      |
| --------------------------------------------- | --------------------------------------------- |
| GET /healthcheck                              | Kiểm tra cả postgres/redis phải true          |
| GET /config/public                            | Project ID công khai; 503 nếu chưa seed       |
| POST /auth/method, /auth/login, /auth/profile | Luồng đăng nhập/chọn profile                  |
| POST /oauth2/token                            | Đổi code PKCE hoặc refresh token              |
| GET /auth/me                                  | Profile, membership, policy và cấu hình phiên |
| POST /oauth2/logout                           | Thu hồi phiên                                 |
| POST /admin/projects/:projectId/invite        | Admin tạo tài khoản/profile/membership        |
| GET /fhir/R4/Patient?name=An                  | Danh sách/tìm kiếm có lọc quyền               |
| POST /fhir/R4/Patient                         | Tạo hồ sơ                                     |
| GET/PUT/DELETE /fhir/R4/Patient/:id           | Xem/sửa/xóa mềm                               |
| GET /fhir/R4/Patient/:id/_history             | Lịch sử phiên bản                             |
| /fhir/R4/Practitioner                         | CRUD/search tương tự                          |
| /fhir/R4/Appointment                          | CRUD/search cơ bản                            |
| /fhir/R4/Schedule, /fhir/R4/Slot               | CRUD/search theo FHIR R4; quyền do policy kiểm tra |
| /fhir/R4/Encounter, Condition, Observation      | CRUD/search cơ bản; quyền do policy/compartment kiểm tra |
| /fhir/R4/MedicationRequest                      | CRUD/search yêu cầu thuốc; app ghi đơn và chuyển active sang stopped/cancelled/completed có lý do |
| /fhir/R4/AllergyIntolerance                     | CRUD/search; staff review xác nhận/bác bỏ, kết thúc theo trạng thái; Patient compartment theo policy mặc định |
| /fhir/R4/ProjectMembership                    | Quản trị trạng thái membership                |

POST `/fhir/R4` nhận FHIR transaction Bundle nếu mọi entry thuộc resource type được bật trong router; các thao tác trong Bundle chạy qua repository và access policy hiện có.

Giao diện `/appointments` dùng FHIR API hiện có: Admin chọn Patient và Slot; Doctor chọn Patient và Slot gắn với profile của mình; Patient chỉ xem Appointment được trả về trong compartment cá nhân. Admin/Doctor có thể tạo Slot một lần trong Schedule của bác sĩ. Repository từ chối create/update Appointment có khoảng thời gian giao nhau, khóa theo project và Practitioner trong transaction, và chỉ cho chuyển sang `cancelled` lịch tương lai đang ở trạng thái `proposed`, `pending`, `booked` hoặc `waitlist`. Booking cập nhật Slot thành `busy` và tạo Appointment trong cùng transaction Bundle; hủy lịch cập nhật Appointment và đặt Slot về `free` trong cùng transaction.

Whitelist trong router còn giữ resource quản trị/definitions cần cho nền tảng và đã mở Encounter, Condition, Observation, MedicationRequest, AllergyIntolerance. App hỗ trợ ghi/xem yêu cầu thuốc và dị ứng cơ bản; Patient compartment dùng policy mặc định; chưa triển khai đầy đủ workflow EHR; Bot và $ai chưa mở.

```ts
const patient = await medplum.createResource({
  resourceType: 'Patient',
  name: [{ family: 'Nguyen', given: ['An'] }],
  gender: 'male',
  birthDate: '2000-01-15',
});
```

Lỗi trả FHIR OperationOutcome: thiếu/sai token 401; không đủ quyền 403 hoặc 404 để tránh lộ resource; dữ liệu sai 400; bản hiện tại đã xóa mềm 410. Search có thể trả Bundle rỗng khi không được xem bản ghi. Kiểm thử trực tiếp nằm trong tests/api.integration.ts.
