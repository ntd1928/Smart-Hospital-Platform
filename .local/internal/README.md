# Snapshot tài liệu nội bộ — nhánh docs

`team/` giữ plan, tracking và handoff cũ; `reports/` giữ báo cáo đối chiếu và QA chi tiết. Các nội dung là snapshot trước đợt dọn repo/CI, có thể chứa đường dẫn đã thay đổi. Không xem trạng thái Git hoặc CI trong các bản này là trạng thái hiện tại.

Snapshot này được duyệt chia sẻ riêng trên nhánh docs; `.local` vẫn gitignored ở main. Nhánh docs không phải ranh giới riêng tư: mọi người có quyền đọc repo đều xem được. Không lưu secret, dữ liệu thật hoặc trace phiên đăng nhập ở đây.

Các báo cáo giữ nguyên trạng thái tại thời điểm viết, gồm những dòng chưa commit/push hoặc chưa có CI; đó không phải trạng thái hiện tại. Context kỹ thuật hiện hành nằm ở main: docs/development/CONTEXT.md, CONTRIBUTING.md và GitHub Issues/PRs. Một số đường dẫn cũ trong snapshot đã đổi sau khi tổ chức lại repo.

Dùng worktree riêng của nhánh docs để sửa tài liệu; không switch trực tiếp từ main khi có ghi chú `.local` chưa sao lưu và không merge nhánh docs vào main. Không xóa bản trên máy trước khi xác minh snapshot remote.
