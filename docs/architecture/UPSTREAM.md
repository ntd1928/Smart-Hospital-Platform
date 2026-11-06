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

`upstream-manifest.json` ghi path/hash upstream và hiện tại. `scripts/extract-upstream.mjs` là công cụ tham khảo dependency khi nhập; chạy app không cần checkout Medplum bên cạnh. Khi phát triển tuần sau, bổ sung từng module với test và cập nhật manifest.
