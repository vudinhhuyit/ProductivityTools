# JiraHelpers

Các công cụ nhỏ hỗ trợ làm việc với Jira.

## Jira shit (Chrome Extension)

Thư mục: [`ChromeExtensions/jira-shit`](ChromeExtensions/jira-shit)

Extension Chrome (Manifest V3) giúp tổng hợp task Jira trong tháng và log work hàng loạt, không cần API token.

### Tính năng chính
- **Liệt kê task**: dán link Jira bất kỳ (issue, board, project…) → lấy các task **Đã xong** và **Đang làm** trong khoảng ngày (mặc định từ ngày 01 tháng này đến hôm nay).
  - Phạm vi: *Đang giao cho tôi*, *Từng giao cho tôi*, *Worklogged* (task tôi đã log work trong khoảng ngày), *Của tất cả mọi người*.
  - Nếu link có mã dự án, có thể giới hạn kết quả trong dự án đó.
  - Lọc theo trạng thái, sắp xếp, copy danh sách.
- **Xuất Excel**: file `.xlsx` gồm Mã, Loại, Tiêu đề, Ngày, Trạng thái, Assignee, Worklogged và 2 cột trống **Logwork**, **Thời gian** để điền.
- **Nhập file Log work**: đọc lại file Excel đã điền, xem trước dòng hợp lệ / dòng lỗi, rồi xác nhận để log lên Jira.
- **Logwork nhanh (8h)**: dán danh sách mã task, extension chia đều 8h (bội số 0,25h) và log nối tiếp nhau từ 08:00 vào ngày đã chọn.
- **Thao tác hàng loạt**: tick chọn nhiều ticket (có lọc theo trạng thái) rồi **comment**, **chuyển trạng thái**, **assign** (reporter / tôi / người khác / bỏ assign) hoặc **logwork 8h/ngày** cho nhiều ngày cùng lúc (xem trước rồi mới xác nhận).
- **Chống log trùng**: worklog có cùng người log, cùng task, cùng thời điểm và cùng số giờ sẽ tự bỏ qua.

### Cài đặt
1. Mở `chrome://extensions` → bật **Developer mode**.
2. Bấm **Load unpacked** → chọn thư mục `ChromeExtensions/jira-shit`.
3. Đăng nhập Jira trên Chrome, bấm icon extension và dán link Jira.

### Cách hoạt động
- Request chạy trong tab Jira (qua `chrome.scripting`) và dùng phiên đăng nhập sẵn có của bạn.
- Đọc task: Jira Cloud `/rest/api/3/search/jql`, tự chuyển sang `/rest/api/2/search` với Jira Server / Data Center.
- Log work: `POST /rest/api/2/issue/{key}/worklog`.
- Comment / chuyển trạng thái / assign: `POST …/comment`, `GET|POST …/transitions`, `PUT …/assignee`.
- Đọc/ghi Excel bằng SheetJS (`xlsx.mini.min.js`), đóng gói sẵn trong extension.

### Cấu trúc
| File | Vai trò |
|---|---|
| `manifest.json` | Khai báo extension (quyền `scripting`, `tabs`, `storage`), phiên bản 1.2.0 |
| `popup.html` | Giao diện popup / trang tab nhập file |
| `popup.js` | Phân tích link, tạo JQL, gọi Jira API, xuất/nhập Excel, log work |
| `parse.js` | Đọc số giờ, thời điểm bắt đầu từ Excel; chia giờ cho Logwork 8h |
| `bulk.js` | Chọn ticket, thao tác hàng loạt: comment, chuyển trạng thái, assign, logwork 8h nhiều ngày |
| `xlsx.mini.min.js` | Thư viện SheetJS |

Hướng dẫn chi tiết (định dạng cột Logwork / Thời gian, quy tắc chia giờ…): xem [README của extension](ChromeExtensions/jira-shit/README.md).
