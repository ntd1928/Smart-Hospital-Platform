# Tài liệu public và nội bộ

| Nơi lưu                                                 | Nội dung                                                                         | Đưa vào Git source?                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| README, CONTRIBUTING, AGENTS                            | Onboarding, quy tắc và context cho người/agent                                   | Có                                               |
| docs/architecture, docs/development                     | Kiến trúc, API, quyết định kỹ thuật, cách chạy và CI                             | Có                                               |
| docs/research, docs/reports/DEMO.md                     | Nghiên cứu không nhạy cảm, kịch bản demo có thể tái hiện                         | Có                                               |
| GitHub Issues/Projects/PRs                              | Task, owner, tiêu chí nghiệm thu, review, bằng chứng test đã lọc                 | Có; nếu repo public thì nội dung này cũng public |
| Không gian chung riêng tư của nhóm                      | Biên bản, phân công có thông tin cá nhân, nháp báo cáo, lịch học, trao đổi riêng | Không nằm trong repo source public               |
| .local/                                                 | Snapshot plan, tracking, handoff và QA đã rà soát                                | Không ở main; chỉ bản được duyệt ở nhánh docs    |
| .env, .runtime, binary, test-results, playwright-report | Secret, dữ liệu máy local, phiên browser và artifact                             | Không                                            |

## Chuyển giao tài liệu nội bộ

Nhánh `docs` có lịch sử riêng, chỉ lưu snapshot `.local/internal/` đã rà soát; không chứa code, CI hoặc là nhánh để merge vào main. `.local/` vẫn bị ignore trên main. Clone main không tự tải tài liệu vào working tree; dùng worktree riêng để tránh ghi đè ghi chú local:

```bash
git fetch origin docs
git worktree add ../Smart-Hospital-Platform-docs docs
```

Trong worktree docs, commit/push các tài liệu đã kiểm tra như bình thường. Không force-add cả `.local` từ main hoặc đưa `.env`, token, database, trace vào nhánh tài liệu. Nhánh không tạo ranh giới quyền truy cập: ai đọc được repo cũng đọc được docs; nếu repo chuyển public, nhánh này và lịch sử của nó cũng public. Thông tin thực sự riêng tư vẫn phải ở workspace/repo private tách biệt có quyền phù hợp.

Không đưa thông tin bắt buộc để build/test hoặc quyết định kiến trúc chỉ vào thư mục ignored. Context kỹ thuật dùng chung ở [CONTEXT](CONTEXT.md); bàn giao kỹ thuật không nhạy cảm ở issue/PR. Khi hoàn thiện báo cáo public, rà soát lại nội dung rồi đưa bản xuất bản vào docs, không công bố nháp tự động.

## Trước khi push

1. Xác định file public bằng `git status --short --untracked-files=all`; kiểm tra ignore bằng `git status --ignored --short .local .runtime`.
2. Chạy `npm run verify` với dịch vụ demo; kiểm tra liên kết và `git diff --check`.
3. Stage theo danh sách cụ thể, xem `git diff --cached --stat` và `git diff --cached`; kiểm tra secret, dữ liệu thật, đường dẫn máy cá nhân, bản quyền.
4. Commit đúng nội dung và ngày thực tế, push feature branch rồi mở PR. Với tài liệu nội bộ đã duyệt, chỉ commit trong worktree nhánh docs; không thêm `.local` vào main.

Nếu dữ liệu nhạy cảm đã từng commit/push, thêm gitignore hoặc xóa file ở commit sau không xóa khỏi lịch sử; phải thu hồi secret và xử lý lịch sử theo quy trình riêng. Việc tách tài liệu không được dùng để bỏ giấy phép hoặc làm sai nguồn gốc mã.
