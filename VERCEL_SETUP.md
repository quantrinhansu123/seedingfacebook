# Deploy lên Vercel (tiếng Việt)

## Lỗi thường gặp

Mở `https://seeding-beta.vercel.app` → nhảy sang `http://localhost:3000` → **ERR_CONNECTION_REFUSED**

**Nguyên nhân:** Vercel build nhầm **Flask** (`app.py`) thay vì **Next.js** (`web/`). Flask redirect về `localhost:3000`.

## Cách sửa (bắt buộc)

### Bước 1 — Root Directory

1. Vào [Vercel Dashboard](https://vercel.com) → project **seeding**
2. **Settings** → **General**
3. **Root Directory** → bấm **Edit** → gõ: `web`
4. **Save**

### Bước 2 — Biến môi trường

**Settings** → **Environment Variables**:

| Tên | Giá trị |
|-----|---------|
| `API_PROXY_BASE_URL` | `https://seeding-fb.onrender.com` |

(Đổi URL nếu backend Flask của bạn khác.)

### Bước 3 — Redeploy

1. **Deployments** → deployment mới nhất
2. **⋯** → **Redeploy**
3. **Bỏ tick** "Use existing Build Cache"
4. **Redeploy**

### Bước 4 — Render (backend) — **bắt buộc redeploy**

Vercel chỉ chạy giao diện. Mọi `/api/*` (trừ vài route Next.js) đều proxy sang **Render**.

Nếu thấy **400** khi thêm nhân sự (`/api/staff-cookies`) mà chưa nhập cookie → Render đang chạy **code cũ** (bắt buộc cookie).

**Cách sửa:**

1. [Render Dashboard](https://dashboard.render.com) → service **Seeding_Fb** (hoặc `seeding-fb.onrender.com`)
2. **Manual Deploy** → branch `main` repo `quantrinhansu123/seeding`
3. Chờ deploy xong (~2–5 phút)
4. Kiểm tra: mở `https://seeding-fb.onrender.com/api/health`  
   Phải thấy `"staff_cookie_optional": true`

Trên Render, service Flask cần:

```
WEB_UI_URL=https://seeding-beta.vercel.app
CORS_ORIGINS=https://seeding-beta.vercel.app,https://.*\.vercel\.app,http://localhost:3000
```

## Kiểm tra thành công

- Mở `https://seeding-beta.vercel.app` → thấy **trang đăng nhập** Seeding Fsolution
- Không còn redirect `localhost:3000`
- Đăng nhập: `khachtest` / `123456`

## Kiến trúc

| Thành phần | Nơi chạy |
|------------|----------|
| Giao diện `web/` | **Vercel** |
| API `app.py` | **Render** / VPS |
| Database | **Supabase** |
