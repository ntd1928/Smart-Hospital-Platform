# Đóng góp và phối hợp

| Vị trí | Phụ trách                              | Bàn giao                                    |
| ------ | -------------------------------------- | ------------------------------------------- |
| A      | Backend/auth/FHIR/seed                 | API và fixture cho B; cách chạy cho C       |
| B      | Frontend/dashboard/bệnh nhân/user      | Browser test cho C; demo cho D              |
| C      | Docker/local/API/E2E                   | Lỗi tái hiện được cho A/B; bằng chứng cho D |
| D      | AI research/kiến trúc/tracking/báo cáo | Context và checklist chung                  |

Đây là phân công gợi ý cho nhóm bốn người, không phải lịch sử đóng góp. Gán thành viên thực tế trên GitHub Issue. Mỗi task có một owner cuối cùng, người hỗ trợ/review được ghi riêng.

1. Đọc [context](docs/development/CONTEXT.md), kiểm tra git status, nhận issue và tiêu chí nghiệm thu. Dùng GitHub Projects: Backlog → Ready → In progress → Review → Done.
2. Branch feat/<task-id>-<mo-ta> hoặc fix/<task-id>-<mo-ta>; ghi khu vực đang sửa để tránh xung đột.
3. Code/test trong phạm vi task. Thay API/policy phải cập nhật tài liệu và bàn giao.
4. PR ghi mục tiêu, hành vi, test thật và giới hạn. Các task sau khởi tạo cần người khác review trước merge.
5. Done cần PR, CI đạt và bằng chứng đáp ứng tiêu chí nghiệm thu. Dừng giữa chừng ghi trạng thái, file đang sửa, lệnh/test đã chạy, blocker và bước tiếp theo vào issue/PR.

Cập nhật ngắn: đã kiểm chứng / đang làm / blocker / cần phối hợp. Quyết định vào kiến trúc; việc chưa làm vào backlog; kết quả test vào PR. AI agent đọc AGENTS.md thay vì chỉ dựa vào chat riêng.

## Kiểm tra trước PR

Theo [README](README.md), chạy dịch vụ, seed và API rồi chạy `npm run verify`. Kiểm tra `git diff --check`, chỉ stage file theo phạm vi và xem `git diff --cached` trước commit. Không dùng commit lùi ngày hoặc mô tả sai nguồn mã. Không commit `.env`, `.runtime`, token, dữ liệu bệnh nhân thật hoặc báo cáo browser có phiên đăng nhập thật. `.local` không vào main; snapshot tài liệu đã duyệt chỉ được chia sẻ ở nhánh docs theo [quy trình tài liệu](docs/development/DOCUMENTATION.md).

CI tự chạy trên PR và main/develop; cấu hình không tự bật branch protection. Maintainer nên yêu cầu PR, ít nhất một reviewer, hai check `Quality` và `Integration`, chặn force push/xóa main và không cho bỏ qua check khi không cần thiết. Cấu hình này thực hiện trên GitHub sau khi workflow có run đầu tiên.

Dùng commit theo thay đổi thực tế, ví dụ `feat(patients): add profile editor`, `docs: organize developer documentation`, `ci: add quality and integration checks`. Chỉ tách commit khi mỗi commit có nội dung rõ ràng và có thể kiểm chứng; không dựng lại lịch sử tuần cũ. Xem [ranh giới public/nội bộ](docs/development/DOCUMENTATION.md).
