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
| GET /fhir/R4/metadata                         | CapabilityStatement phản ánh read/search/history cho resource lâm sàng operation-managed; không quảng cáo CRUD ghi trực tiếp |
| POST /admin/projects/:projectId/invite        | Admin tạo tài khoản/profile/membership        |
| GET /fhir/R4/Patient?name=An                  | Admin xem toàn project; Doctor chỉ tìm Patient được gán qua generalPractitioner; Patient xem compartment cá nhân |
| POST /fhir/R4/Patient                         | Admin tạo hồ sơ; Doctor không có quyền tạo Patient |
| GET/PUT/DELETE /fhir/R4/Patient/:id           | Patient chỉ đọc/cập nhật hồ sơ mình, chỉ đổi phone/email/address; Doctor chỉ đọc/cập nhật Patient được gán; Admin quản lý phân công/xóa mềm |
| GET /fhir/R4/Patient/:id/_history             | Lịch sử phiên bản                             |
| /fhir/R4/Practitioner                         | CRUD/search tương tự                          |
| /fhir/R4/Organization, HealthcareService      | Admin quản lý Khoa phân cấp và dịch vụ gắn với Khoa; Practitioner chỉ đọc qua policy |
| /fhir/R4/PractitionerRole                     | Admin gán/ngừng phân công Practitioner cho HealthcareService và Organization; Practitioner chỉ đọc |
| /fhir/R4/Appointment                          | CRUD/search; Patient dùng `$available` để lọc Slot trống 90 ngày theo HealthcareService, `$book`, `$cancel`, `$reschedule`, `$waitlist` (ưu tiên ngày theo timezone, cập nhật idempotent); staff dùng `$staff-cancel` (lý do bắt buộc, quyền theo vai trò/phân công, giải phóng Slot nguyên tử), `$check-in`, `$record-outcome`, `$offer-waitlist` và `$start-encounter`; outcome được khóa/kiểm tra project, actor, trạng thái và thời gian trong transaction; thao tác bắt đầu Encounter kiểm tra lịch arrived/fulfilled, Patient và Practitioner được phân công, tạo Encounter liên kết trong transaction và trả Encounter đã có nếu thao tác lặp |
| /fhir/R4/Encounter                            | Không CRUD ghi trực tiếp; `$record`, `$update-details`, `$add-note`, `$cancel`, `$complete` kiểm tra assignment/participation, khóa Encounter và audit actor/lý do; create từ Appointment chống trùng với `$start-encounter` |
| /fhir/R4/Schedule, /fhir/R4/Slot               | CRUD/search theo FHIR R4; staff quản lý series qua nested FHIR Extension trên Schedule và Slot.identifier, gồm timezone IANA cố định để sửa rule từ trình duyệt khác vẫn giữ giờ địa phương; occurrence rơi vào giờ không tồn tại do DST được bỏ qua; quy tắc vẫn hiện/sửa được khi hết Slot trống; thay đổi quy tắc và Slot tương lai trong transaction tối đa 100 entry; hủy ngừng Slot trống theo batch 100 rồi xóa quy tắc; Slot đã đặt được giữ nguyên |
| /fhir/R4/Condition                             | Read/search; mọi vai trò không CRUD trực tiếp; `$record` kiểm tra Patient/Encounter/assignment và gắn recorder; `$review` chuyển xác nhận, bác bỏ, active, inactive, resolved hoặc entered-in-error với lý do bắt buộc, per-Condition lock, version guard và actor audit |
| /fhir/R4/Observation                            | Read/search; mọi ghi qua `$record` (1–100 Observation nguyên tử, kiểm tra Patient/Encounter/assignment và gắn Practitioner) hoặc `$update` (amended/entered-in-error, khóa resource, lý do bắt buộc và actor audit); staff ghi dấu hiệu sinh tồn theo LOINC/UCUM, huyết áp dạng component |
| /fhir/R4/MedicationRequest                      | Read/search; không CRUD ghi trực tiếp; `$record` yêu cầu xác nhận rà soát dị ứng, kiểm tra Patient/Encounter/Practitioner và ghi kết quả đối chiếu tên từ AllergyIntolerance trong transaction; `$update-status` khóa cập nhật trạng thái và lưu lý do/actor audit; liều, đường dùng, tần suất được lưu có cấu trúc |
| /fhir/R4/MedicationStatement                    | Read/search theo Patient compartment; không CRUD ghi trực tiếp; `$record` xác minh Patient, assignment, Encounter/MedicationRequest liên quan và gắn nguồn/actor; `$update-status` khóa cập nhật trạng thái, bắt buộc lý do và lưu audit note; lưu liều khai báo có cấu trúc cùng liên kết đơn kê |
| /fhir/R4/MedicationAdministration               | Read/search; không CRUD ghi trực tiếp; staff dùng `$record` để kiểm tra Patient assignment, project, MedicationRequest active/đúng thuốc và Encounter cùng Patient, rồi gắn Practitioner cùng audit note; `$update` khóa và đánh dấu entered-in-error kèm lý do/actor, không xóa dữ liệu gốc |
| /fhir/R4/AllergyIntolerance                     | Read/search; không CRUD ghi trực tiếp; staff dùng `$record` để gắn Practitioner recorder và `$review` để xác minh/chuyển trạng thái, gồm entered-in-error; yêu cầu lý do, khóa resource, kiểm tra version và lưu actor audit |
| /fhir/R4/ProjectMembership                    | Admin quản lý vai trò và trạng thái membership; backend khóa thao tác hạ quyền/ngừng Admin cuối cùng trong project |

POST `/fhir/R4` nhận FHIR transaction Bundle nếu mọi entry thuộc resource type được bật trong router; các thao tác trong Bundle chạy qua repository và access policy hiện có. Màn `/users` lọc thành viên theo tên/email, cấp quyền Admin cho Practitioner, chuyển họ về Doctor và khóa/mở membership; không cho tự khóa hoặc tự đổi quyền. Repository tuần tự hóa cập nhật ProjectMembership và từ chối hạ quyền/ngừng Admin cuối cùng.

Giao diện `/appointments` dùng FHIR API: Admin/Doctor đặt lịch cho Patient đã chọn; Patient xem lịch tương lai trong 90 ngày, chỉ nhận thông tin cơ bản về Slot/Schedule/Practitioner còn hoạt động và tự đặt/hủy/đổi lịch bằng các operation Patient-scoped. `$book` xác minh profile Patient, Slot còn trống, Schedule/Practitioner còn hoạt động và xung đột Appointment; việc đánh dấu Slot `busy` và tạo Appointment chạy trong một transaction server-side. Khi không có lịch trống, Patient có thể đăng ký yêu cầu `waitlist` cho HealthcareService với khoảng ngày mong muốn tối đa một năm theo timezone trình duyệt; gửi lại cập nhật yêu cầu cùng dịch vụ idempotent và lưu audit note. Staff xem preference, lọc Slot theo dịch vụ, Practitioner được phân công và ngày ưu tiên; backend xác minh lại preference trước khi cập nhật Slot và Appointment trong transaction. `$cancel` xác minh Appointment thuộc Patient đang đăng nhập, cho hủy yêu cầu chờ chưa xếp giờ hoặc lịch tương lai hợp lệ và giải phóng Slot cùng transaction. Staff dùng `$staff-cancel` với lý do bắt buộc; Admin có thể hủy yêu cầu chờ chưa xếp lịch, Doctor chỉ hủy Appointment gán cho chính mình, thao tác có khóa, kiểm tra trạng thái/thời gian và giải phóng Slot cùng transaction. `$reschedule` xác minh Appointment của Patient đang đăng nhập, chuyển sang một Slot còn trống và giải phóng Slot cũ trong cùng transaction. `$check-in` chỉ nhận Practitioner đã xác thực, cho phép check-in từ bốn giờ trước đến khi lịch kết thúc, đổi trạng thái sang `arrived` và ghi thời điểm, người xác nhận cùng ghi chú vào Appointment.note; cập nhật có điều kiện theo version để tránh ghi đè đồng thời. Patient không được cấp quyền FHIR trực tiếp để tạo Appointment hoặc sửa Slot. Admin/Doctor có thể tạo Slot một lần trong Schedule của bác sĩ. Repository từ chối create/update Appointment có khoảng thời gian giao nhau và tuần tự hóa thao tác theo Practitioner trong transaction.

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
