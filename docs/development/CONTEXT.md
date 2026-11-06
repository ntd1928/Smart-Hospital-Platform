# Context dùng chung

Smart Hospital Platform là đồ án môn Phát triển ứng dụng điện toán đám mây. Đợt hiện tại chỉ thực hiện tuần 5–6, tái sử dụng phần cần thiết của Medplum 5.2.7 (upstream commit dbaac8c2e). Repo nhóm không phải toàn bộ monorepo upstream.

## Kiến trúc hiện tại

React/TypeScript/Vite tại packages/app → SDK @medplum/core → Express/auth/FHIR repository tại packages/server → PostgreSQL 16 và Redis 7. Thư viện Medplum dùng phiên bản cố định 5.2.7. API localhost:8103; web localhost:3000.

Demo: `docker compose up --build -d --wait --wait-timeout 600` chạy toàn bộ stack. PostgreSQL/Redis healthy → seed hoàn tất → API healthy → Nginx phục vụ SPA đã build. Volume giữ database/cache/demo fixture/binary nội bộ; không dùng dữ liệu thật. Chế độ phát triển vẫn có thể dùng `npm run services:up` chỉ chạy PostgreSQL/Redis, API/Vite chạy trên host. Không chạy hai chế độ đồng thời trên cổng 3000/8103. Xem [Docker](DOCKER.md).

Admin: project-admin Practitioner. Doctor: Practitioner với policy mặc định Medplum. Patient: compartment cá nhân theo policy mặc định. Membership/profile do backend xác thực, không lấy quyền từ query string hoặc localStorage tự đặt. Ba vai trò dùng chung app và dashboard có nội dung theo quyền.

## Giới hạn

Appointment có API FHIR cơ bản và giao diện đặt/hủy lịch dành cho Admin/Doctor; Patient chỉ xem lịch thuộc compartment cá nhân. Form liệt kê Slot trống trong Schedule đang hoạt động; nhân viên có thể tạo Slot một lần hoặc tạo lịch lặp theo ngày trong tuần (tối đa 100 Slot mỗi transaction). Các Slot cùng một batch có identifier chung để nhận diện series. Repository từ chối Appointment create/update giao nhau theo Practitioner, Slot create/update giao nhau trên các Schedule active của cùng Practitioner, và Slot giao nhau với Appointment active; transaction lock dùng Practitioner để tuần tự hóa các lượt ghi liên quan. Form staff cũng so Slot dự kiến với các Slot đã tải từ mọi Schedule active của Practitioner. Slot cần khoảng thời gian hợp lệ, Schedule active có actor Practitioner và Practitioner không ở trạng thái inactive; không thể đánh dấu free, đổi Schedule hoặc sửa thời gian của Slot còn được Appointment active tham chiếu. Không thể đổi active status hoặc Practitioner actor của Schedule khi Schedule còn Slot free trong tương lai; UI có thể tắt Schedule và ngừng các Slot free tương lai trong cùng transaction, tối đa 1.000 thao tác, giữ nguyên Appointment đã đặt. Chỉ cho hủy Appointment tương lai ở trạng thái có thể hủy. Đặt lịch cập nhật Slot thành bận và tạo Appointment trong cùng FHIR transaction; hủy lịch cập nhật Appointment và giải phóng Slot trong transaction. Sinh lịch lặp dùng giờ địa phương của trình duyệt, giới hạn khoảng ngày một năm, bỏ các khung giờ trùng Slot hoặc Appointment hiện có. Nhân viên có thể chọn tối đa 20 series gần đây được nhớ trong sessionStorage của tab, ngừng Slot tương lai còn trống hoặc thay thế Slot trống tương lai của series; Slot đã có lịch hẹn được giữ nguyên. Chưa có chỉnh sửa quy tắc đầy đủ, tra cứu toàn bộ series hoặc quản lý sau khi session kết thúc. Lịch lặp theo quy tắc FHIR đầy đủ chưa có. Schedule/Slot CRUD/search đã mở và seed tạo fixture mẫu; bệnh nhân tự đặt và quản lý thay đổi lịch nâng cao chưa có. FHIR API đã mở Encounter, Condition, Observation và MedicationRequest; app có trang EHR cơ bản để staff ghi resource và Patient đọc lịch sử theo policy/compartment, gồm yêu cầu thuốc với cách dùng, lượng cấp và số lần cấp thêm. Form Encounter hỗ trợ tham chiếu Appointment đã hoàn tất; chưa có kiểm tra tính nhất quán hoặc đầy đủ vòng đời EHR, AI runtime, S3, cloud, CD hay monitoring. FHIR definitions/schema nền vẫn có các kiểu dữ liệu chung để repository/validator hoạt động; có schema không đồng nghĩa module nghiệp vụ đã triển khai.

Bản tách dành cho database local mới; không hỗ trợ nâng cấp database Medplum đang vận hành. Các hook Bot, subscription/background job và cloud storage đã được loại khỏi luồng chạy. Redis vẫn là cache và phục vụ auth/session theo upstream.

## Kiểm chứng và phối hợp

GitHub Issues/Projects quản lý công việc, owner, phụ thuộc và tiêu chí nghiệm thu; PR ghi kết quả test và giới hạn. Kiến trúc và cách chạy bắt buộc nằm trong repo, không phụ thuộc tài liệu riêng của một thành viên. Xem [CONTRIBUTING](../../CONTRIBUTING.md) và [phân loại tài liệu](DOCUMENTATION.md).

CI được cấu hình cho pull request và push vào main/develop: quality gate trước, kiểm thử API/E2E trên PostgreSQL/Redis sau. Chưa có CD. Chỉ kết luận CI hosted đạt khi có run tương ứng trên GitHub; chạy local không thay thế bằng chứng đó. Xem [CI](CI.md).

Credentials demo chỉ phục vụ localhost và runner CI dùng dữ liệu giả; token và mật khẩu môi trường thật không được commit. Trước thao tác Git, kiểm tra git status và yêu cầu hiện hành.

