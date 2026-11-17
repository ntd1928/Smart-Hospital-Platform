# Nguồn mã và cách tách Medplum

Upstream: https://github.com/medplum/medplum, commit `dbaac8c2e13c3fb2b61059d413587ba8bb4e22c0`, package version 5.2.7. LICENSE và NOTICE giữ ở root. Repo nhóm kế thừa mã upstream; commit phản ánh ngày nhập/tích hợp thực tế.

## Tái sử dụng

Source backend gồm auth/password/PKCE/token/logout, project/membership/policy, PostgreSQL repository, tìm kiếm, lookup, validation, audit, Redis cache, schema migration và seed FHIR definitions. SDK/core, fhir-router, definitions, fhirtypes và React components dùng dependency npm 5.2.7 được khóa trong package-lock, không nhập toàn bộ monorepo.

Frontend khởi tạo theo mẫu Medplum app: MedplumClient, provider, Mantine, router; SignInForm dùng component upstream. Nhóm bổ sung dashboard, trang quản lý và cấu hình cho phạm vi đồ án. Manifest ghi file có đối ứng upstream và hash để kiểm tra nguồn gốc.

## Điều chỉnh

- App/router mở auth, invite quản trị, Patient/Practitioner, Organization/HealthcareService/PractitionerRole, Appointment/Schedule/Slot và API Encounter/Condition/Observation/MedicationRequest/MedicationStatement/MedicationAdministration/AllergyIntolerance; app có danh mục Khoa/Dịch vụ, phân công bác sĩ qua PractitionerRole, quản lý membership và trang EHR cơ bản cho ghi/đọc resource. Cập nhật ProjectMembership được tuần tự hóa để không thể hạ quyền/ngừng Admin cuối cùng. Chưa có đầy đủ vòng đời EHR hoặc kiểm tra tương tác thuốc-dị ứng. Không mở AI/Bot, bulk data, HL7/DICOM hoặc SCIM.
- Repository giữ CRUD, policy, transaction, search, history; bỏ hook Bot pre-commit và background/subscription/WebSocket jobs. Không có worker giả thay thế.
- Config chỉ giữ file/env; storage nội bộ chỉ filesystem; bỏ cloud config/storage/email SES. Tuần này chưa có API upload tài liệu.
- Giữ chuỗi schema nền upstream để repository/search/validator làm việc đúng. Không giữ bộ data-upgrade/worker dành cho Medplum cũ. Chỉ hỗ trợ database local mới của dự án, không nâng cấp database Medplum đang vận hành.
- Definitions, bảng schema và kiểu dùng chung còn có resource của các tuần sau. API whitelist mở Organization/HealthcareService và Encounter/Condition/Observation/MedicationRequest/MedicationStatement/MedicationAdministration/AllergyIntolerance và app có danh mục khoa cùng giao diện EHR cơ bản; form Encounter hỗ trợ tham chiếu Appointment đã hoàn tất; kiểm tra tương tác thuốc-dị ứng, tính nhất quán, upload tài liệu và các workflow lâm sàng đầy đủ chưa triển khai.
- Lint tập trung code nhóm; code kế thừa được typecheck/build và kiểm thử tích hợp. Format có thể làm hash khác bản gốc dù logic giữ nguyên.

- Form EHR ghi dấu hiệu sinh tồn bằng Observation LOINC/UCUM; huyết áp giữ hai component tâm thu/tâm trương trong một resource. Một lượt ghi gửi tất cả Observation trong FHIR transaction; UI hỗ trợ đọc và sửa component huyết áp.
- Policy backend thu hẹp dữ liệu Patient/clinical cho Practitioner theo Patient.generalPractitioner; Admin quản lý phân công trong Patient editor. Chỉ dùng AccessPolicy đã có, không thay authorization bằng ẩn menu.
- Patient tự cập nhật contact details qua policy FHIR; repository khôi phục read-only fields theo hiện hữu, kể cả giá trị falsy.
- Appointment check-in được nối tới Encounter: staff bắt đầu Encounter từ lịch arrived/fulfilled qua transaction server-side có kiểm tra Practitioner được gán và chống tạo trùng.
- Encounter lifecycle dùng `$record`, `$update-details`, `$add-note`, `$cancel` và `$complete` server-side; kiểm tra Patient assignment, project, Practitioner được phân công/tham gia hoặc Admin, trạng thái và thời gian, khóa ghi Encounter/Appointment, yêu cầu lý do chỉnh sửa/hủy và lưu actor cùng audit note. Tạo từ Appointment và bắt đầu từ lịch dùng chung khóa để chống Encounter trùng.
- Appointment outcome (fulfilled/noshow) dùng operation server-side có khóa theo Appointment, kiểm tra actor, project, trạng thái và thời gian trước khi ghi kết quả/lý do audit.
- MedicationStatement CRUD của Practitioner được chuyển sang operation server-side để kiểm tra Patient được gán, tính nhất quán Encounter/MedicationRequest và actor audit; policy chặn ghi trực tiếp.
- MedicationRequest kê đơn và cập nhật vòng đời chuyển sang operation server-side có assignment/Encounter validation, rà soát AllergyIntolerance medication đang active, xác nhận người kê và audit; policy chặn Practitioner ghi trực tiếp.
- AllergyIntolerance create/review chuyển sang operation server-side có assignment check, lock và audit reason; policy chặn Practitioner ghi trực tiếp.
- Condition recording/review chuyển sang `$record`/`$review`: Patient assignment, liên kết Encounter cùng Patient, chuyển trạng thái có ràng buộc, lý do bắt buộc, per-resource lock/version guard và Practitioner audit; policy giữ Patient read-only và chặn CRUD trực tiếp.
- Observation ghi đơn lẻ hoặc batch 1–100 dùng `$record` nguyên tử; `$update` xử lý amended/entered-in-error dưới lock, assignment/project validation và actor/reason audit. Policy chặn ghi CRUD trực tiếp để giữ history Patient read-only.
- AccessPolicy chặn FHIR CRUD writes cho Encounter, Condition, Observation, MedicationRequest, MedicationStatement, MedicationAdministration và AllergyIntolerance trên mọi role; resource được ghi qua operation lifecycle có kiểm tra/audit.
- Waitlist Appointment hỗ trợ khoảng ngày mong muốn theo timezone IANA của Patient; cập nhật request cùng dịch vụ idempotent, lọc Slot phía staff và kiểm tra lại preference trong operation server-side.
- Staff Appointment cancellation chuyển từ transaction do client dựng sang operation server-side có role/assignment check, lý do bắt buộc, khóa theo Appointment và cập nhật Slot nguyên tử.
- Recurring Slot rule lưu timezone IANA và tạo interval theo giờ địa phương của zone đó thay vì timezone hiện tại của trình duyệt; giờ địa phương không tồn tại khi chuyển DST bị bỏ qua.
- Series lịch lặp được lưu bằng nested FHIR Extension trên Schedule, hiển thị và chỉnh sửa cả khi không còn Slot trống; thay quy tắc cùng các Slot tương lai bằng transaction có giới hạn, hủy rule theo batch và giữ Slot đã đặt.
- Recurring Slot series được phát hiện lại từ identifier đã lưu trên FHIR Slot và Schedule, thay danh sách 20 series trong sessionStorage; staff tra cứu, thay hoặc ngừng Slot trống tương lai sau khi đăng nhập lại.

`upstream-manifest.json` ghi path/hash upstream và hiện tại. `scripts/extract-upstream.mjs` là công cụ tham khảo dependency khi nhập; chạy app không cần checkout Medplum bên cạnh. Khi phát triển tuần sau, bổ sung từng module với test và cập nhật manifest.
