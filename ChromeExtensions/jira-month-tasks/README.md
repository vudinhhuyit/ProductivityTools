# Jira Tasks (Chrome Extension)

Dán link Jira → liệt kê task **Đã xong** và **Đang làm** trong khoảng ngày (mặc định từ ngày 01 tháng này đến hôm nay) → xuất Excel → điền giờ → **Logwork** ngược lên Jira.

## Cài đặt
1. Giải nén thư mục `jira-month-tasks`.
2. Mở `chrome://extensions` → bật **Developer mode**.
3. Bấm **Load unpacked** → chọn thư mục `jira-month-tasks`.
   (Nếu đã cài bản cũ: bấm nút ⟳ reload của extension.)

## Xem & xuất task
1. Đăng nhập Jira trên Chrome.
2. Bấm icon extension, dán link Jira bất kỳ (issue, board, project…) → **Tải**.
3. Chọn khoảng ngày **Từ – đến** (mặc định: ngày 01 tháng hiện tại → hôm nay).
4. Chọn phạm vi **Task**:
   - *Đang giao cho tôi*: `assignee = currentUser()`
   - *Từng giao cho tôi*: `assignee WAS currentUser()`, gồm cả task đang giao cho bạn và task đã chuyển sang người khác
   - *Worklogged*: mọi task bạn đã log work trong khoảng ngày (`worklogAuthor = currentUser()` + `worklogDate`), ở bất kỳ trạng thái nào
   - *Của tất cả mọi người*: không lọc theo người
5. Bảng gồm: **Mã, Loại** (Task / Bug / Story / Sub-task…; Bug tô đỏ)**, Tiêu đề, Ngày, Trạng thái, Assignee, Worklogged** (tổng thời gian đã log của task, vd `4h`, `2,5h`).
6. **Xuất Excel** → file `.xlsx` có thêm 2 cột trống **Logwork** và **Thời gian** để bạn điền.

## Điền file Excel
| Cột | Ví dụ | Ý nghĩa |
|---|---|---|
| Logwork | `2h`, `2,5h`, `30m`, `1h30m` | Số giờ cần log |
|  | `3` | không ghi `h`/`m` → tính là giờ (3h) |
| Thời gian | `08:00 09/10/2026` | Thời điểm bắt đầu |
|  | `14:00 9/10` | thiếu năm → năm hiện tại |
|  | `9 9` | thiếu phút → 00 (09:00 ngày 9 tháng này) |
|  | `9` | thiếu tháng → tháng hiện tại, thiếu giờ → 08:00 |

Dòng nào thiếu một trong hai cột thì bỏ qua và báo lỗi.

## Nhập file Log work
1. Bấm **Nhập file Log work**. Extension mở trang ở dạng tab, vì hộp chọn file có thể làm popup tự đóng. Trang này có phần hướng dẫn quy tắc Logwork và Thời gian.
2. Bấm **Nhập file Log work** lần nữa → chọn file Excel đã điền.
3. Xem bảng xem trước (dòng hợp lệ / dòng lỗi) → **Xác nhận log**.
4. Worklog trùng (cùng người log, cùng mã, cùng thời điểm, cùng số giờ) sẽ tự bỏ qua, nên lỡ tải lại cùng một file cũng không bị log đôi.

## Logwork (8h)
Chọn ngày (mặc định hôm nay), dán các mã task cách nhau bởi dấu phẩy (vd `ABC-1, ABC-2, ABC-3`), rồi bấm **Log work**. Worklog được ghi vào ngày đã chọn.
- Tổng 8h chia đều cho các task. Số giờ mỗi task là bội số của 0,25h (0,25h, 0,5h, 0,75h … 8h), nhỏ nhất 0,25h.
  Phần dư cộng vào các task đầu để tổng đúng 8h (vd 3 task: 2,75h + 2,75h + 2,5h). Nếu nhập hơn 32 task, mỗi task 0,25h và tổng vượt 8h.
- Các task được log nối tiếp nhau trong ngày đã chọn, bắt đầu từ 08:00 (vd 3 task: 08:00, 10:45, 13:30).
- Mã trùng chỉ tính một lần, mã sai định dạng bị bỏ qua. Bấm Log work lại cũng không bị log đôi.

## Kỹ thuật
- Không cần API token: request chạy trong tab Jira, dùng phiên đăng nhập của bạn.
- Đọc task: Jira Cloud `/rest/api/3/search/jql`, tự chuyển sang `/rest/api/2/search` cho Server/Data Center.
- Log work: `POST /rest/api/2/issue/{key}/worklog`, chạy được trên cả Cloud và Server.
- Đọc/ghi Excel bằng SheetJS (`xlsx.mini.min.js`), đóng gói sẵn trong extension.
