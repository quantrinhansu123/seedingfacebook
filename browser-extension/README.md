# Seeding Fsolution Bridge

Extension này dùng để gửi bình luận TikTok và lấy cookie Facebook khi admin bấm nút trên web bằng chính phiên đăng nhập Chrome của khách. Web không tự đọc cookie nền; extension chỉ trả cookie khi người dùng chủ động bấm.

## Cài đặt cho khách

1. Mở Chrome và vào `chrome://extensions`.
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Chọn thư mục `browser-extension` trong source dự án.
5. Đăng nhập TikTok/Facebook trên Chrome.
6. Mở web Seeding Fsolution:
   - Vào `Lead` hoặc `TikTok CMT`, chọn video và bấm `Gửi CMT TikTok`.
   - Vào `Quản lý Cooki` -> thêm/sửa nhân sự -> bấm `Lấy từ Chrome` để lấy cookie Facebook.
   - Vào `TikTok CMT` -> `Một kênh`, dán `@username` hoặc link kênh. Extension sẽ mở kênh TikTok trong Chrome, cuộn trang để gom link video thật, rồi web mới đọc comment theo từng video.

## Cập nhật extension

Khi source có thay đổi extension:

1. Mở `chrome://extensions`.
2. Bấm nút reload trên `Seeding Fsolution Bridge` hoặc bấm `Update`.
3. Đảm bảo version hiện tại là `0.1.5` trở lên.
4. Tải lại web Seeding Fsolution trước khi test lại `TikTok CMT`.

## Lưu ý vận hành

- Không cần dán cookie TikTok vào web để gửi comment.
- Lấy comment theo kênh TikTok cần extension đang bật, vì TikTok chỉ hiện đủ danh sách video sau khi Chrome render/scroll trang kênh.
- Khi trả lời TikTok từ Inbox, extension sẽ mở đúng video, cố gắng tìm comment đang chọn theo nội dung/tác giả và tô xanh comment đó để sale dán câu trả lời thủ công.
- Facebook cookie chỉ được lấy khi admin bấm nút, không tự động thu thập nền.
- Nếu TikTok hỏi đăng nhập lại, hãy đăng nhập trực tiếp trên tab TikTok rồi bấm gửi lại.
- Extension chỉ gửi khi người dùng bấm nút, không có chế độ tự spam hoặc chạy nền hàng loạt.
