# Rà soát test và comment

Ngày: 22/10/2026. Áp dụng test-compactor sau khi verify đạt, sau đó comment-compactor cho các điểm mã tách/sửa. Không thay đổi production code trong vòng rà soát test.

## Inventory test

Mỗi dòng nêu lớp kiểm thử, hành vi và lỗi riêng mà nó phát hiện. API/E2E dùng server, PostgreSQL và Redis thật; không mock quyền truy cập.

| ID  | Hành vi được kiểm tra                                   | Lỗi riêng được phát hiện                                                                  |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| U1  | Role thiếu membership/profile hoặc profile không hỗ trợ | UI tự cấp vai trò mặc định cho phiên chưa xác định                                        |
| U2  | Ánh xạ Admin/Doctor/Patient                             | Patient bị nâng quyền chỉ vì admin flag hoặc Doctor bị nhận nhầm Admin                    |
| U3  | Tên FHIR text/structured/fallback                       | Mất tên text hoặc hiển thị undefined cho hồ sơ chưa có tên                                |
| A1  | Health PostgreSQL/Redis                                 | HTTP health thành công nhưng dependency không kết nối                                     |
| A2  | Không token/token sai                                   | Bỏ middleware xác thực                                                                    |
| A3  | Sai mật khẩu                                            | Password verification bị bỏ qua                                                           |
| A4  | Profile/membership ba vai trò                           | Seed hoặc auth gắn sai profile/policy                                                     |
| A5  | Patient CRUD/search/history/delete                      | Dữ liệu sửa không lưu, lookup không cập nhật hoặc mất lịch sử/xóa mềm                     |
| A6  | Gender FHIR không hợp lệ                                | Không bật terminology validation                                                          |
| A7  | Practitioner CRUD/search                                | API sai resource hoặc không lưu trạng thái Practitioner                                   |
| A8  | Patient search/direct read giới hạn cá nhân             | Query không lọc compartment hoặc ID đọc trực tiếp bỏ qua policy                           |
| A9  | Patient ghi hồ sơ khác/tạo tùy ý                        | Write guard chỉ kiểm tra đăng nhập                                                        |
| A10 | Doctor/Patient gọi admin invite                         | Route quản trị thiếu kiểm tra project-admin                                               |
| A11 | Doctor tự nâng membership                               | FHIR update cho phép leo thang quyền                                                      |
| A12 | Admin đọc project khác                                  | Quyền admin bị hiểu thành server super-admin                                              |
| A13 | Appointment theo compartment                            | Lộ lịch của người khác hoặc trả rỗng giả thay vì lịch được phép                           |
| A14 | Module tương lai chưa mở                                | Router vô tình mở EHR/Bot/AI ngoài phạm vi                                                |
| A15 | Appointment CRUD                                        | Liên kết Patient hoặc cập nhật trạng thái cơ bản không lưu                                |
| A16 | Invite/khóa/mở tài khoản                                | Membership inactive không chặn phiên hiện tại/đăng nhập mới                               |
| A17 | Refresh token                                           | Token mới không thiết lập được phiên hợp lệ                                               |
| A18 | Logout thu hồi token                                    | Chỉ xóa storage ở frontend, token cũ vẫn dùng được                                        |
| E1  | Patient CRUD bằng browser                               | Form binding, nút submit/search hoặc điều hướng sai dù API đúng                           |
| E2  | Doctor reload/guard/logout                              | UI mất session sau reload hoặc route quản trị không chặn                                  |
| E3  | Patient mở URL hồ sơ người khác                         | UI còn hiển thị dữ liệu cũ khi request mới bị từ chối                                     |
| E4  | Admin tạo/khóa/mở user trên UI                          | Invite không invalidate cache, tài khoản mới không hiện; tài khoản máy bị gắn nhãn Doctor |

## Kết quả test-compactor

Giữ 25 nhóm kiểm tra: 3 unit + 18 API + 4 E2E. Không xóa/skip test quyền. Tổng số dòng ba file chính giữ 348 → 348. Siết A13 để Patient thứ hai phải có lịch được phép, tránh mệnh đề every() đúng trên danh sách rỗng; bỏ assertion token tồn tại vì request auth/me thành công đã chứng minh token hợp lệ.

Coverage riêng packages/app/src/access.ts trước/sau: statements 12/12, branches 17/17, functions 2/2, lines 8/8. Đây không phải coverage toàn ứng dụng. Unit baseline 606 ms, sau review 379 ms; E2E baseline 22.5 s, sau review 20.1 s, không coi biến thiên môi trường này là kết quả tối ưu hiệu năng. Tất cả bộ test đã chạy lại và đạt. Không xóa/merge test nên không có mutant cần chứng minh cho việc xóa.

Fingerprint toàn bộ file ngoài tests/ (kể cả file mới chưa commit) trước/sau đều `bacd0b4aef827bfe8d980acac6fcc112d192091965782b2f3eec98ac82798869`. Fingerprint git diff ngoài test cũng không đổi.

## Kết quả comment-compactor

Sửa comment config còn quảng bá cloud prefixes đã loại bỏ; email không còn quảng bá SES; bỏ mô tả heartbeat/worker không có trong bản tách; sửa chú thích pre-commit thành invariant đọc writer chống replica lag. Cập nhật hợp đồng CLI của extractor, rút gọn giới hạn fresh-database và ghi nguồn bootstrap. Giữ SPDX/license, hợp đồng public API và các giải thích transaction/concurrency hữu ích từ upstream. Manifest được tính lại sau vòng này.
