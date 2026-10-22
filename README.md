# Smart Hospital — tài liệu nhóm

Nhánh `docs` chỉ chứa snapshot tài liệu đã duyệt, có lịch sử tách biệt với `main`. Không chứa mã ứng dụng hoặc CI; không merge nhánh này vào main.

- [Hướng dẫn snapshot](.local/internal/README.md)
- [Plan](.local/internal/team/PLAN.md)
- [Tracking](.local/internal/team/TRACKING.md)
- [Handoff](.local/internal/team/HANDOFF.md)
- [Đối chiếu tuần 5–6](.local/internal/reports/WEEK56.md)
- [QA review](.local/internal/reports/QA-REVIEW.md)

Các tài liệu là snapshot tại thời điểm viết, không phải trạng thái mới nhất của code/Git/CI. Context kỹ thuật hiện hành ở main: `docs/development/CONTEXT.md`, `CONTRIBUTING.md` và Issues/PRs. Một số đường dẫn trong bản lưu cũ đã đổi khi tổ chức lại repo.

Nhánh không có quyền riêng: ai đọc được repo cũng đọc được tài liệu. Nếu repo chuyển public, tài liệu và lịch sử docs cũng public. Không đưa secret, dữ liệu bệnh nhân thật, database hoặc trace đăng nhập vào đây.

## Cập nhật

Từ checkout main, tạo worktree riêng một lần:

```bash
git fetch origin docs
git worktree add ../Smart-Hospital-Platform-docs docs
```

Nếu worktree đã tồn tại, dùng thư mục đó; không chạy lại lệnh add. Trong worktree docs, sửa tài liệu, xem diff rồi commit/push bình thường. Không force-add `.local` vào main hoặc switch trực tiếp main/docs khi có ghi chú local chưa sao lưu.
