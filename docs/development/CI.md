# Continuous Integration

Giai đoạn hiện tại dùng CI, chưa dùng CD: chưa có staging, domain, cloud secrets, ngân sách hoặc quy trình rollback. Workflow không publish image, deploy hay thay cấu hình AWS/GitHub repository.

## Pipeline

[ci.yml](../../.github/workflows/ci.yml) chạy trên PR, push main/develop và thao tác Run workflow. Hai job chạy tuần tự:

| Check       | Thực hiện                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Quality     | Node theo .nvmrc, npm 11.21.1, npm ci, typecheck, lint, format, unit tests, build                                                 |
| Integration | Runner riêng, cài Chromium, build/chạy toàn bộ Compose (PostgreSQL, Redis, seed, API, Nginx), healthcheck, API tests, browser E2E |

Integration dùng cùng stack Compose demo để giữ REPEATABLE READ, Redis password/AOF và healthcheck. Seed phải hoàn tất trước API, Nginx chờ API healthy. CI copy fixture từ volume seed sang host trước khi test; E2E_EXTERNAL_SERVER=1 buộc browser kiểm tra SPA Nginx, không khởi động Vite. Mỗi job chạy trên GitHub-hosted Ubuntu 24.04 sạch, không đụng database local/staging. Đầu tiên seed/migration FHIR có thể mất vài phút. Xem [Docker](DOCKER.md).

Không chạy test:persistence trong CI nền tảng vì script restart dịch vụ; chạy riêng local với API đã dừng khi cần kiểm tra volume. Unit/API/E2E hiện không thay thế load test, đánh giá bảo mật đầy đủ hoặc kiểm thử hạ tầng cloud.

## Quyền và dữ liệu

GITHUB_TOKEN chỉ có contents:read, checkout không giữ credential; không dùng pull_request_target và không yêu cầu secret. Actions khóa theo commit SHA; Dependabot đề xuất cập nhật hàng tuần, vẫn cần review. Cache chỉ npm cache, không cache database/phiên đăng nhập.

Không upload artifact tự động: browser trace/screenshot có thể chứa token phiên. Report chỉ lưu tạm trên runner, bị mất khi runner được thu hồi. Log CI chỉ dùng kết quả test với dữ liệu giả. Không dùng workflow này với tài khoản, API URL hoặc secret môi trường thật. Không xuất `.runtime`, `.env`, binary hay database ra artifact.

Hủy run cũ cùng PR/branch khi có run mới; timeout giới hạn thời gian. Docker dừng ở bước always, runner bị hủy sẽ được GitHub thu hồi. Build artifact chưa publish vì chưa có đích triển khai.

## Kiểm chứng và merge

Trên local: làm theo README rồi chạy `npm run verify`. Có thể lint workflow bằng [actionlint](https://github.com/rhysd/actionlint). Chạy local xác nhận các lệnh, nhưng không chứng minh môi trường GitHub-hosted đã đạt.

Sau push đầu tiên, vào Actions kiểm tra cả hai check và nhật ký. Maintainer bật branch protection/ruleset yêu cầu PR, reviewer và Quality/Integration. Chưa cấu hình những thiết lập remote này từ source; chưa có hosted run trước khi push. Nếu workflow không được chạy do Actions policy, maintainer phải cho phép các official actions đã pin.

Khi có staging: bổ sung Docker image, registry, environment approval, cloud identity (ưu tiên OIDC), migration/backup, healthcheck và rollback trong thiết kế CD riêng.

Tham khảo chính thức: [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [secure use](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions).
