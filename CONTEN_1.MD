# Content Sài Thành — Đặc tả tính năng & nút bấm (note cho Dev)

File demo tham chiếu: `ContentSaiThanh_Unified_Demo.html`. Tài liệu này mô tả ý nghĩa/hành vi của từng vùng, từng nút, để dev đối chiếu và chỉnh lại đúng theo hệ thống thật (gắn API, lưu DB, v.v.). Phần demo hiện tại chỉ là giao diện tĩnh + JS giả lập (alert/confirm), chưa gọi AI hay lưu dữ liệu thật.

---

## 1. Thanh điều hướng trên cùng (Top bar)

| Vùng | Ý nghĩa |
|---|---|
| Logo + "Content Sài Thành" | Tên thương hiệu nội bộ của hệ thống, thay cho "Aica" |
| Các tab: Content Plan, Content, Setup, Dashboard, Nội dung, Lịch MKT 2026, Campaign Lớn, Ngày Đôi & Sale, Nhân sự | Điều hướng module — tab "Content" đang active là khu vực Script Writer trong demo này; các tab khác là module quản lý khác của hệ thống, không thuộc phạm vi demo |
| Pill "AI · Gemini 3.1 Flash Lite" | Hiển thị model AI đang dùng + trạng thái kết nối (chấm xanh = online) — dev cần map động theo model thực tế đang cấu hình ở Setup |
| Pill "⚙ Setup" | Lối tắt đến trang cấu hình AI (chọn model, API key, giới hạn credit...) |
| Avatar "A" | Tài khoản người dùng đang đăng nhập |

---

## 2. Thanh icon dọc bên trái (Icon rail)

| Icon | Ý nghĩa |
|---|---|
| 📝 Script (đang active) | Module soạn kịch bản — chính là khu vực demo này |
| 📅 Kế hoạch | Module lập kế hoạch nội dung |
| 💬 Bình luận | Module quản lý/seeding bình luận |
| 📰 Bài viết | Module bài viết dài (nếu có) |
| 📣 Đăng nhóm | Module đăng bài vào nhóm/group |
| 🤖 AI | Lối tắt mở nhanh panel AI |
| ⚙️ Setup | Cấu hình hệ thống |

*Lưu ý dev: phần này demo chỉ làm icon tĩnh, cần gắn route/điều hướng thực tế giữa các module.*

---

## 3. Panel danh sách kịch bản (Script list)

| Thành phần | Ý nghĩa / Hành vi mong đợi |
|---|---|
| Tiêu đề "Scripts" | Tên panel |
| Nút "+ Mới" | Tạo 1 kịch bản trống mới, tự động thêm vào đầu danh sách và mở trong khung soạn bên phải |
| Ô tìm kiếm | Tìm kịch bản theo tiêu đề (lọc theo thời gian thực — dev cần debounce ~300ms) |
| Dropdown "Tất cả" | Lọc theo nền tảng (Facebook/Youtube/TikTok) |
| Mỗi item kịch bản | Hiển thị: tiêu đề, tag nền tảng, tag trạng thái (OK = đã duyệt / Chờ = chờ duyệt / Nháp = bản nháp), người phụ trách. Click vào item để mở kịch bản đó trong khung soạn bên phải (**demo chưa gắn hành vi click-để-mở, dev cần bổ sung load dữ liệu kịch bản tương ứng**) |
| **🗑 Icon xóa (mới thêm)** | Xóa kịch bản đó khỏi danh sách. Demo hiện chỉ xóa khỏi DOM + có hộp `confirm()` xác nhận. **Dev cần đổi thành gọi API xóa thật (soft-delete khuyến nghị, không xóa cứng để có thể khôi phục), và chặn xóa nếu kịch bản đã ở trạng thái "Đã duyệt" + đang được lên lịch đăng, hoặc cảnh báo rõ trước khi xóa.** |

---

## 4. Khung soạn kịch bản (Editor — khu vực giữa)

| Thành phần | Ý nghĩa |
|---|---|
| Dòng meta (42 từ · 3 blocks...) | Thống kê tự động: số từ, số block, gợi ý tương tác (kéo thả, đổi định dạng) |
| Ô tiêu đề kịch bản | Tên kịch bản, lưu cùng record |
| Dropdown nền tảng | TikTok / Youtube / Facebook — quyết định khung định dạng hiển thị (giới hạn ký tự, gợi ý timeline giây cho video) |
| Dropdown trạng thái | Đã duyệt / Chờ duyệt / Nháp — dùng cho luồng phê duyệt nội dung giữa Content & quản lý |
| Nút "💾 Lưu" | Lưu toàn bộ nội dung các block hiện tại vào kịch bản |
| Icon "📤 Gửi" | Gửi kịch bản cho người duyệt / đẩy sang hàng chờ đăng |
| Icon "🖨 In" | Xuất/in kịch bản (PDF hoặc bản in tay cho sale đọc khi livestream) |
| **Icon "🗑 Xóa" (mới thêm)** | Xóa kịch bản đang mở. Demo có `confirm()` trước khi xóa, sau đó alert giả lập. **Dev cần: (1) gọi API xóa thật, (2) sau khi xóa thành công, tự động chuyển sang kịch bản kế tiếp trong danh sách hoặc về trạng thái trống, (3) ghi log ai xóa — lúc nào, để audit.** |
| Icon "✨ AI" | Mở panel AI bên phải (nếu đang thu gọn) |
| Mỗi block (Hook/Mở đầu/CTA...) | Đơn vị nội dung trong kịch bản — có thể kéo-thả đổi vị trí (⠿), đổi loại block, và **tự gõ tay trực tiếp** (contenteditable) |
| Nút "+ Thêm block (tự viết tay)" | Cho phép người dùng tự thêm 1 đoạn nội dung mới hoàn toàn bằng tay, không cần AI — đáp ứng đúng yêu cầu "vừa tham khảo AI vừa tự viết" |

---

## 5. Panel AI (bên phải) — 4 tab chức năng

### 5.1 Tab "✍️ Viết nhanh" — tạo nội dung mới bằng AI có cấu trúc

| Trường | Ý nghĩa | Bắt buộc |
|---|---|---|
| Loại nội dung | Định dạng đầu ra: TikTok/Reels, Youtube dài, Youtube Shorts, Bài Facebook, Livestream, Script inbox | Có |
| Sản phẩm/Dịch vụ | Đối tượng được quảng bá (VD: loại đàn cụ thể) | **Bắt buộc** |
| Ý tưởng/nội dung muốn AI triển khai | Brief chính — đây là ô mà người dùng "ra đề" cho AI, quan trọng nhất | **Bắt buộc** |
| Vấn đề/nỗi đau khách hàng | Insight để AI khai thác đúng tâm lý người mua | Khuyến nghị |
| Đối tượng mục tiêu (chip tuổi) | Khoanh vùng độ tuổi để AI chọn từ vựng phù hợp | Không |
| Văn phong (chip) | Tone giọng văn: Chuyên gia / Gần gũi / Hài hước / Cảm xúc | Không |
| Công thức Marketing | Khung lập luận: PAS, AIDA, BAB, Storytelling, Social Proof | Không |
| **Hồ sơ văn phong đã lưu** | Chọn 1 "DNA văn phong" đã học trước đó để AI viết đúng giọng thương hiệu, không cần dán mẫu lại mỗi lần | Không |
| **"+ Học văn phong mới..." → ô dán văn phong mẫu (mới thêm)** | Khi chọn mục này, hiện ra: ô "Tên hồ sơ" + ô "Dán văn bản mẫu" + nút "💾 Lưu văn phong mẫu". Đây chính là tính năng phân tích DNA giọng văn còn thiếu trước đó. **Dev cần: gọi API gửi văn bản mẫu cho AI phân tích (tone, cấu trúc câu, từ vựng đặc trưng) → lưu thành 1 "voice profile" gắn với tài khoản/thương hiệu → hiển thị lại trong dropdown cho các lần tạo nội dung sau.** |
| Mục mở rộng (CTA, độ dài, từ cần tránh) | Tùy chọn nâng cao, ẩn mặc định để form không bị dài, người mới dùng vẫn thấy gọn | Không |
| Nút "🚀 Tạo nội dung" | Gửi toàn bộ trường trên thành 1 prompt → AI trả về theo từng block (Hook/Mở đầu/CTA...) | — |
| Nút "➕ Chèn [Hook/Mở đầu/CTA]" dưới kết quả | Đẩy đúng đoạn đó thành 1 block mới trong khung soạn ở giữa — đây là điểm nối giữa "AI gợi ý" và "tự viết tay" | — |

### 5.2 Tab "✨ Cải thiện"

| Trường | Ý nghĩa |
|---|---|
| Ô nội dung cần cải thiện | Văn bản gốc cần AI chỉnh sửa |
| Link "📥 Lấy nội dung từ script hiện tại" | Tự động kéo toàn bộ nội dung các block đang mở trong khung soạn vào ô này — tránh phải copy tay |
| Chip chọn phần cải thiện (đa chọn) | Tự khám lỗi / Súc tích hơn / Tăng cảm xúc / Thêm số liệu / Đổi CTA / Check compliance / Giữ văn phong-đổi topic |
| Mục tiêu cải thiện cụ thể | Mô tả tự do điều chưa hài lòng, giúp AI sửa đúng trọng tâm thay vì viết lại toàn bài |
| 🔒 Giữ nguyên đoạn nào | Đánh dấu phần AI không được động vào (vd: CTA đã chốt, số liệu đã duyệt) |
| Nút "✨ Cải thiện ngay" | Gửi yêu cầu, AI trả bản đã sửa kèm nút chèn lại vào script |

### 5.3 Tab "💡 Hook/Ý tưởng"

| Trường | Ý nghĩa |
|---|---|
| Mục tiêu marketing | Định hướng loại hook (educate, bán hàng, đồng cảm, viral...) |
| Định dạng hook | Câu hỏi / Số liệu sốc / Ngược đời / Trước-sau — ép AI bám đúng 1 kiểu mở đầu |
| Chủ đề/sản phẩm | Nội dung hook sẽ xoay quanh chủ đề này |
| Số lượng ý tưởng | Số hook AI trả về (3/5/10) |
| Nút "💡 Gợi ý hook" | Trả về danh sách hook, mỗi dòng có nút ➕ riêng để chèn thẳng làm block "Hook" trong script — không cần dùng cả tab Viết nhanh nếu chỉ cần phần mở đầu |

### 5.4 Tab "💬 Chat"

| Thành phần | Ý nghĩa |
|---|---|
| Các nút nhanh (Hook/CTA/Tiêu đề) | Sinh nhanh 1 câu không cần điền form — dùng khi chỉ cần gợi ý ngắn, tốc độ là ưu tiên |
| Khung chat + ô nhập | Hỏi đáp tự do với AI như trợ lý thông thường, không theo cấu trúc form — phù hợp khi cần AI giải thích, brainstorm, hoặc hỏi nhanh ngoài luồng |

---

## 6. Lưu ý kỹ thuật tổng quát cho Dev

Toàn bộ nút "Tạo/Cải thiện/Gợi ý" trong demo đang trả về **nội dung mẫu cố định** (hard-code trong JS) để minh họa luồng — cần thay bằng lệnh gọi API thật tới model AI (đang hiển thị là Gemini 3.1 Flash Lite ở top bar) kèm prompt được ráp từ các trường trong form theo đúng thứ tự: Văn phong/Hồ sơ giọng → Đối tượng/Insight → Công thức marketing → Mục tiêu/CTA → Ràng buộc nền tảng.

Hai nút xóa (xóa từ danh sách và xóa từ toolbar soạn) hiện dùng `confirm()` của trình duyệt — nên thay bằng modal xác nhận đồng bộ giao diện, và bắt buộc soft-delete (đánh dấu đã xóa, không xóa cứng khỏi DB) để tránh mất dữ liệu do bấm nhầm.

Tính năng "Học văn phong mới" hiện chỉ lưu tên hồ sơ vào dropdown phía client (mất khi tải lại trang) — cần lưu thật vào DB gắn theo brand/tài khoản, và lý tưởng nhất là cho phép xem lại/sửa/xóa từng hồ sơ văn phong đã lưu ở trang Setup.
