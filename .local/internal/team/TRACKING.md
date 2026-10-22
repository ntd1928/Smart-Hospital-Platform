# Theo dõi tuần 5–6

Trạng thái: Todo → In progress → Blocked hoặc Verified. Verified cần kết quả kiểm chứng, không chỉ file tồn tại. Đối chiếu lệnh, môi trường và giới hạn ở [WEEK56](../reports/WEEK56.md), review ở [QA-REVIEW](../reports/QA-REVIEW.md).

| ID     | Đầu ra                                 | Owner dự kiến | Trạng thái | Bằng chứng                                                         |
| ------ | -------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------ |
| W56-01 | Tách dependency, attribution, manifest | A             | Verified   | Build/typecheck; manifest 248 file khớp; không thiếu dependency    |
| W56-02 | PostgreSQL/Redis/Docker local          | C             | Verified   | Hai healthcheck đạt; persistence sau restart đạt 2 kiểm tra        |
| W56-03 | Auth/session/ba vai trò                | A             | Verified   | API role/refresh/logout; E2E đăng nhập ba vai trò và reload        |
| W56-04 | Dashboard và Patient Management        | B             | Verified   | Browser CRUD/search/chi tiết; truy cập trái quyền bị chặn          |
| W56-05 | User/Practitioner và Appointment API   | A+B           | Verified   | API CRUD; Admin tạo/khóa/mở account qua UI                         |
| W56-06 | Seed và kiểm thử quyền                 | C             | Verified   | Hash seed trước/sau trùng; 3 unit, 18 API, 4 E2E đạt               |
| W56-07 | AI research và tài liệu kiến trúc      | D             | Verified   | Tài liệu có nguồn; context/plan/workflow/handoff/issue/PR template |
| W56-08 | Audit và bàn giao local                | D             | Verified   | npm run verify exit 0; QA review; chưa commit/push theo yêu cầu    |

A/B/C/D là vị trí phân công cho nhóm, không phải tên người hoặc bằng chứng đóng góp. A: backend/auth; B: frontend; C: môi trường/test; D: nghiên cứu/tài liệu. Đợt tích hợp hiện tại được thực hiện trong phiên làm việc hỗ trợ này; nhóm cần tự review, phân công tên thật và hiểu source trước báo cáo.

## Backlog giữ đúng phạm vi

- Phân quyền nâng cao theo từng bệnh nhân được phân công: chưa triển khai, dùng policy mặc định Medplum.
- Lịch sử khám/EHR: tuần 8; không nhầm với resource version history.
- Giao diện bác sĩ chuyên biệt, lịch làm việc và quy trình đặt khám/chống trùng: các mốc tiếp theo.
- RAG/chatbot, S3/cloud, CI/CD/monitoring: theo PLAN, chưa triển khai ở bản này.
- Commit/push: chỉ thực hiện khi người dùng yêu cầu lại; không tự push sau khi đóng goal local.
