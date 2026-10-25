# Giơ Thẻ – trang web

Học sinh giơ thẻ trả lời A/B/C/D, giáo viên quét bằng camera (laptop hoặc điện thoại), kết quả hiện ngay trên máy chiếu.

## Đưa lên mạng (chọn 1 trong 2 cách)

### Cách 1 – Netlify (nhanh nhất)
1. Vào https://app.netlify.com/drop và đăng nhập bằng tài khoản Google.
2. Kéo thả **cả thư mục `Gio-The-web`** vào khung trên trang.
3. Netlify cấp địa chỉ dạng `https://ten-ngau-nhien.netlify.app`. Có thể đổi tên tại *Site configuration → Change site name* (ví dụ `giothe-lacsy`).
4. Khi có bản cập nhật: vào trang của site → *Deploys* → kéo thả thư mục mới vào ô *“Drag and drop your site output folder here”*.

### Cách 2 – GitHub Pages
1. Tạo kho (repository) mới trên GitHub, ví dụ `giothe`, chế độ **Public**.
2. Bấm *Add file → Upload files*, kéo thả **toàn bộ nội dung bên trong** thư mục `Gio-The-web` (index.html, sw.js, manifest.webmanifest, .nojekyll, thư mục assets, icons) → *Commit changes*.
3. Vào *Settings → Pages* → *Source: Deploy from a branch* → *Branch: main / (root)* → *Save*.
4. Sau 1–2 phút trang có địa chỉ `https://<tên-tài-khoản>.github.io/giothe/`.

## Dùng trong lớp
- **Laptop** (nối máy chiếu) mở địa chỉ trang web bằng Chrome hoặc Edge.
- Bấm **“Liên kết điện thoại”** → hiện mã QR.
- **Điện thoại** quét mã QR (camera hoặc Zalo) → mở bằng Chrome/Safari → cho phép camera → **“Bắt đầu quét”**, lia qua lớp. Kết quả hiện ngay trên máy chiếu; điện thoại có nút chuyển câu, hiện đáp án.
- Hoặc quét bằng camera của laptop / webcam như trước (nút “Bắt đầu quét” trên laptop).

## Ghi chú
- Lần đầu mở cần có mạng; sau đó trang được lưu trong trình duyệt và **vẫn mở được khi mất mạng** (liên kết điện thoại và tạo câu hỏi bằng AI thì cần mạng).
- Có thể *“Cài đặt ứng dụng” / “Thêm vào màn hình chính”* để mở như một ứng dụng.
- Lớp, câu hỏi, kết quả lưu trong trình duyệt của từng máy. Chuyển từ bản cũ: ở bản cũ vào *Cài đặt → Xuất bản sao lưu*, ở trang web vào *Cài đặt → Nhập bản sao lưu*.
- Liên kết điện thoại dùng máy chủ trung gian công cộng (MQTT) với mã phòng ngẫu nhiên; chỉ số thẻ, chữ cái đáp án và nội dung câu hỏi được gửi đi, **tên học sinh không rời khỏi laptop**.
- **Tự tạo câu hỏi từ tài liệu bằng Gemini (miễn phí):** lấy khóa tại https://aistudio.google.com/apikey → *Create API key*, dán vào *Cài đặt → Trợ lý AI (Gemini)* (hoặc ngay trong cửa sổ “Tạo câu hỏi từ tài liệu”). Khóa chỉ lưu trong trình duyệt của máy đó; nội dung tài liệu được gửi tới Google khi tạo câu hỏi.
- Nhập bộ câu hỏi soạn bằng AI: tab *Câu hỏi → “Nhập bộ từ file (.json)”* (xem file mẫu `Mau-bo-cau-hoi-GioThe.json`).
