# Nguồn mã và cách tách Medplum

Upstream: https://github.com/medplum/medplum, commit `dbaac8c2e13c3fb2b61059d413587ba8bb4e22c0`, package version 5.2.7. LICENSE và NOTICE giữ ở root. Repo nhóm kế thừa mã upstream; commit phản ánh ngày nhập/tích hợp thực tế.

## Tái sử dụng

Source backend gồm auth/password/PKCE/token/logout, project/membership/policy, PostgreSQL repository, tìm kiếm, lookup, validation, audit, Redis cache, schema migration và seed FHIR definitions. SDK/core, fhir-router, definitions, fhirtypes và React components dùng dependency npm 5.2.7 được khóa trong package-lock, không nhập toàn bộ monorepo.

Frontend khởi tạo theo mẫu Medplum app: MedplumClient, provider, Mantine, router; SignInForm dùng component upstream. Nhóm bổ sung dashboard, trang quản lý và cấu hình cho phạm vi đồ án. Manifest ghi file có đối ứng upstream và hash để kiểm tra nguồn gốc.

## Điều chỉnh

- App/router chỉ mở auth, invite quản trị và resource tuần 5–6. Không mở AI/Bot, EHR, bulk data, HL7/DICOM, SCIM hoặc workflow đặt khám nâng cao.
- Repository giữ CRUD, policy, transaction, search, history; bỏ hook Bot pre-commit và background/subscription/WebSocket jobs. Không có worker giả thay thế.
- Config chỉ giữ file/env; storage nội bộ chỉ filesystem; bỏ cloud config/storage/email SES. Tuần này chưa có API upload tài liệu.
- Giữ chuỗi schema nền upstream để repository/search/validator làm việc đúng. Không giữ bộ data-upgrade/worker dành cho Medplum cũ. Chỉ hỗ trợ database local mới của dự án, không nâng cấp database Medplum đang vận hành.
- Definitions, bảng schema và kiểu dùng chung vẫn có tên resource của các tuần sau. Chúng không phải module nghiệp vụ đã hoàn thành; API whitelist và test xác nhận chưa mở các module đó.
- Lint tập trung code nhóm; code kế thừa được typecheck/build và kiểm thử tích hợp. Format có thể làm hash khác bản gốc dù logic giữ nguyên.

`upstream-manifest.json` ghi path/hash upstream và hiện tại. `scripts/extract-upstream.mjs` là công cụ tham khảo dependency khi nhập; chạy app không cần checkout Medplum bên cạnh. Khi phát triển tuần sau, bổ sung từng module với test và cập nhật manifest.
