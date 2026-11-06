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
| GET /fhir/R4/Patient?name=An                  | Admin xem toàn project; Doctor chỉ tìm Patient được gán qua generalPractitioner; Patient xem compartment cá nhân |
| POST /fhir/R4/Patient                         | Admin tạo hồ sơ; Doctor không có quyền tạo Patient |
| GET/PUT/DELETE /fhir/R4/Patient/:id           | Patient chỉ đọc/cập nhật hồ sơ mình, chỉ đổi phone/email/address; Doctor chỉ đọc/cập nhật Patient được gán; Admin quản lý phân công/xóa mềm |
| GET /fhir/R4/Patient/:id/_history             | Lịch sử phiên bản                             |
| /fhir/R4/Practitioner                         | CRUD/search tương tự                          |
| /fhir/R4/Organization, HealthcareService      | Admin quản lý Khoa phân cấp và dịch vụ gắn với Khoa; Practitioner chỉ đọc qua policy |
| /fhir/R4/PractitionerRole                     | Admin gán/ngừng phân công Practitioner cho HealthcareService và Organization; Practitioner chỉ đọc |
| /fhir/R4/Appointment                          | CRUD/search; Patient dùng `$available` để lọc Slot trống 90 ngày theo HealthcareService, `$book`, `$cancel`, `$reschedule`, `$waitlist`; staff dùng `$check-in`, `$record-outcome`, `$offer-waitlist` và `$start-encounter`; outcome được khóa/kiểm tra project, actor, trạng thái và thời gian trong transaction; thao tác bắt đầu Encounter kiểm tra lịch arrived/fulfilled, Patient và Practitioner được phân công, tạo Encounter liên kết trong transaction và trả Encounter đã có nếu thao tác lặp |
| POST /fhir/R4/Encounter/$complete             | Staff hoàn tất Encounter đang mở với clinical summary bắt buộc; kiểm tra assignment/participation hoặc Admin, ghi summary/actor và thời điểm kết thúc trong transaction |
| /fhir/R4/Schedule, /fhir/R4/Slot               | CRUD/search theo FHIR R4; quyền do policy kiểm tra |
| /fhir/R4/Encounter, Condition, Observation      | CRUD/search cơ bản; EHR in tóm tắt hoặc xuất FHIR document preliminary từ tài nguyên đã tải; ghi chú Encounter có loại diễn biến/đánh giá/kế hoạch/thủ thuật; staff ghi dấu hiệu sinh tồn thành Observation mã LOINC, đơn vị UCUM (huyết áp dạng component) trong một FHIR transaction; sửa kết quả sang amended hoặc đánh dấu entered-in-error kèm lý do/audit note; rà soát tham chiếu trong hồ sơ đã tải; cập nhật Encounter/Condition có audit note; quyền do policy/compartment kiểm tra |
| /fhir/R4/MedicationRequest                      | CRUD/search yêu cầu thuốc; app lưu liều, đường dùng, tần suất có cấu trúc; so tên thuốc dạng văn bản với dị ứng thuốc đang hoạt động, lưu kết quả rà soát vào audit note, chuyển trạng thái có lý do và đánh dấu entered-in-error |
| /fhir/R4/MedicationStatement                    | Read/search theo Patient compartment; Practitioner không CRUD trực tiếp; `$record` xác minh Patient, assignment, Encounter/MedicationRequest liên quan và gắn nguồn/actor; `$update-status` khóa cập nhật trạng thái, bắt buộc lý do và lưu audit note; lưu liều khai báo có cấu trúc cùng liên kết đơn kê |
| /fhir/R4/MedicationAdministration               | Staff ghi nhận qua `$record`; backend kiểm tra Patient/đơn kê/Encounter, gắn Practitioner đã xác thực và ghi audit; Patient chỉ đọc lịch sử trong compartment |
| /fhir/R4/AllergyIntolerance                     | CRUD/search; staff review xác nhận/bác bỏ, kết thúc theo trạng thái; Patient compartment theo policy mặc định |
| /fhir/R4/ProjectMembership                    | Admin quản lý vai trò và trạng thái membership; backend khóa thao tác hạ quyền/ngừng Admin cuối cùng trong project |

POST `/fhir/R4` nhận FHIR transaction Bundle nếu mọi entry thuộc resource type được bật trong router; các thao tác trong Bundle chạy qua repository và access policy hiện có. Màn `/users` lọc thành viên theo tên/email, cấp quyền Admin cho Practitioner, chuyển họ về Doctor và khóa/mở membership; không cho tự khóa hoặc tự đổi quyền. Repository tuần tự hóa cập nhật ProjectMembership và từ chối hạ quyền/ngừng Admin cuối cùng.

Giao diện `/appointments` dùng FHIR API: Admin/Doctor đặt lịch cho Patient đã chọn; Patient xem lịch tương lai trong 90 ngày, chỉ nhận thông tin cơ bản về Slot/Schedule/Practitioner còn hoạt động và tự đặt/hủy/đổi lịch bằng các operation Patient-scoped. `$book` xác minh profile Patient, Slot còn trống, Schedule/Practitioner còn hoạt động và xung đột Appointment; việc đánh dấu Slot `busy` và tạo Appointment chạy trong một transaction server-side. Khi không có lịch trống, Patient có thể đăng ký một yêu cầu `waitlist` cho HealthcareService; endpoint chống tạo trùng theo Patient/dịch vụ. Nhân viên chỉ ghép yêu cầu này với Slot thuộc Practitioner đang được phân công cho dịch vụ; Slot và Appointment được cập nhật trong cùng transaction. `$cancel` xác minh Appointment thuộc Patient đang đăng nhập, cho hủy yêu cầu chờ chưa xếp giờ hoặc lịch tương lai hợp lệ và giải phóng Slot cùng transaction. `$reschedule` xác minh Appointment của Patient đang đăng nhập, chuyển sang một Slot còn trống và giải phóng Slot cũ trong cùng transaction. `$check-in` chỉ nhận Practitioner đã xác thực, cho phép check-in từ bốn giờ trước đến khi lịch kết thúc, đổi trạng thái sang `arrived` và ghi thời điểm, người xác nhận cùng ghi chú vào Appointment.note; cập nhật có điều kiện theo version để tránh ghi đè đồng thời. Patient không được cấp quyền FHIR trực tiếp để tạo Appointment hoặc sửa Slot. Admin/Doctor có thể tạo Slot một lần trong Schedule của bác sĩ. Repository từ chối create/update Appointment có khoảng thời gian giao nhau và tuần tự hóa thao tác theo Practitioner trong transaction.

Whitelist trong router còn giữ resource quản trị/definitions cần cho nền tảng và đã mở Encounter, Condition, Observation, MedicationRequest, MedicationStatement, MedicationAdministration, AllergyIntolerance. App hỗ trợ kê thuốc, ghi nhận liều đã dùng, đối soát thuốc đang dùng và ghi nhận dị ứng; Patient compartment dùng policy mặc định; chưa triển khai đầy đủ workflow EHR; Bot và $ai chưa mở.

```ts
const patient = await medplum.createResource({
  resourceType: 'Patient',
  name: [{ family: 'Nguyen', given: ['An'] }],
  gender: 'male',
  birthDate: '2000-01-15',
});
```

Lỗi trả FHIR OperationOutcome: thiếu/sai token 401; không đủ quyền 403 hoặc 404 để tránh lộ resource; dữ liệu sai 400; bản hiện tại đã xóa mềm 410. Search có thể trả Bundle rỗng khi không được xem bản ghi. Kiểm thử trực tiếp nằm trong tests/api.integration.ts.
