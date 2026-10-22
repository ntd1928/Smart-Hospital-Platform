# Đối chiếu đầu ra tuần 5–6

Ngày kiểm chứng: 22/10/2026, múi giờ Việt Nam. Đây là đợt hiện thực hóa/kiểm chứng hiện tại, không phải bằng chứng nhóm đã tự viết Medplum hoặc hoàn thành ở ngày báo cáo cũ.

| Đầu mục đã báo cáo              | Hiện thực trong repo                                                | Bằng chứng nghiệm thu                                  |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Backend, PostgreSQL, Redis      | Express/auth/repository tách từ Medplum; Compose hai dịch vụ        | Build/typecheck, Compose health và API healthcheck     |
| API user/lịch hẹn cơ bản, FHIR  | Invite/membership, Patient, Practitioner, Appointment               | API integration CRUD và dữ liệu liên kết               |
| Login và dashboard ba vai trò   | SignInForm upstream; app và dashboard theo profile/membership       | Playwright Admin/Doctor/Patient                        |
| Frontend–backend                | SDK gọi API local thật                                              | Browser CRUD và session reload                         |
| Login/logout/quản lý phiên      | PKCE, access/refresh token, thu hồi Login                           | API token sai, refresh/logout; browser reload/logout   |
| Phân quyền cơ bản               | Project-admin/Practitioner/patient compartment bằng policy upstream | Truy cập chéo hồ sơ, API quản trị và project isolation |
| Thêm/sửa/chi tiết/tìm bệnh nhân | FHIR CRUD và UI chuyên biệt nhỏ                                     | API + Playwright CRUD/search                           |
| Patient/Practitioner chuẩn FHIR | Repository/schema/validation upstream; bật terminology              | API từ chối gender không hợp lệ; Practitioner CRUD     |
| Dữ liệu mẫu và test             | Seed idempotent, tài khoản giả lập, project isolation               | Seed chạy lại giữ ID; unit/API/E2E                     |
| Docker local                    | PostgreSQL 16, Redis 7, volume và healthcheck                       | Chạy Compose; kiểm chứng persistence sau restart       |
| Khảo sát LLM/RAG/nguồn y khoa   | AI-RESEARCH.md có nguồn đã tra cứu                                  | Tài liệu khảo sát; chưa có benchmark/model runtime     |
| Phối hợp nhóm                   | Context/plan/tracking/handoff/workflow, issue và PR template        | Kiểm tra liên kết và nội dung docs                     |

## Kết quả kiểm thử

Vòng verify cuối sau sửa code, cài sạch dependency và rà soát test/comment đã kết thúc thành công (exit 0):

| Kiểm tra                               | Kết quả thực tế                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| npm ci bằng Node 22.22.0 / npm 11.21.1 | Đạt; 396 package được cài, audit báo 0 vulnerability tại thời điểm chạy                                    |
| npm run typecheck                      | Đạt cho app, server, seed và test                                                                          |
| npm run lint / format:check            | Đạt                                                                                                        |
| npm test                               | 3 unit test đạt                                                                                            |
| npm run build                          | App và server build thành công; target Node 22 được kiểm chứng bằng chạy bản JavaScript đã build           |
| npm run test:api                       | 18 nhóm kiểm tra đạt trên API/PostgreSQL/Redis thật                                                        |
| npm run test:e2e                       | 4 kịch bản Chromium đạt; vòng cuối 20.6 giây                                                               |
| npm run verify                         | Toàn bộ các cổng trên đạt trong cùng một lần chạy                                                          |
| npm run test:persistence               | Đạt: 11 hồ sơ đối chiếu (10 demo + 1 isolation) giữ nguyên sau restart; khóa thử Redis còn nguyên qua AOF  |
| Seed chạy lại                          | Giữ nguyên ID và hash .runtime/demo.json: d68804267afcbd3fae7f6774b7cea4638a97f5e7e60c61ec8d24b3f5f266e95f |
| Manifest nguồn mã                      | 248 file nguồn/license có hash đối chiếu, không có mismatch; dependency closure không báo file thiếu       |
| Tài liệu                               | Liên kết Markdown nội bộ được kiểm tra; xem QA-REVIEW.md cho inventory test và review comment              |

Môi trường xác nhận: Docker Engine 29.1.3, Compose v2.40.2-desktop.1, PostgreSQL 16.15, Redis 7.4.11; Node/npm như trên. Launcher npx trong README cũng được thử và trả đúng Node/npm.

Trong quá trình test đã phát hiện và sửa parser application/fhir+json, terminology validation, build target cho cú pháp using trên Node 22, nhầm tài khoản máy thành Doctor và cache danh sách sau invite. Không bỏ hoặc skip test lỗi để đạt kết quả. Một bản ghi giả lập với gender sai sinh ra trước khi bật validation đã được xóa mềm, giữ history.

Có cảnh báo kích thước bundle frontend khoảng 780 kB trước gzip; build vẫn đạt. Tối ưu bundle, load test và đánh giá khả năng mở rộng thuộc giai đoạn sau. Coverage 100% chỉ áp dụng hai helper trong access.ts, không phải toàn hệ thống.

Theo yêu cầu mới nhất, kết quả bàn giao nằm ở working tree local: chưa tạo commit mới, chưa push. HEAD và origin/main vẫn là initial commit 5a18031. Không đưa token, database, node_modules hoặc runtime artifacts lên Git.

## Giới hạn giữ đúng báo cáo và lộ trình

- Chưa xây lịch sử khám bệnh bằng Encounter/Condition/Observation; tuần 8.
- UI bác sĩ hiện là danh sách/chi tiết/thêm/sửa cơ bản, chưa có lịch làm việc/chuyên khoa chuyên biệt.
- Phân quyền nâng cao theo phân công hồ sơ chưa triển khai; dùng policy Medplum mặc định, có test các đường truy cập cơ bản. Không tuyên bố đã kiểm chứng mọi tổ hợp AccessPolicy của upstream.
- Appointment mới là CRUD và dữ liệu mẫu, không có chống trùng hoặc quy trình đặt/sửa/hủy tuần 7.
- AI mới khảo sát; chưa có RAG/chatbot hoạt động. Chưa triển khai cloud staging, S3 hoặc CI/CD/monitoring.
