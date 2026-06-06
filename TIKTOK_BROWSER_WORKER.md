# TikTok Browser Worker

Worker nay dung de gui comment TikTok bang Playwright tren mot service rieng. Vercel van chay UI/API binh thuong, con worker chay Chrome that tren Render/VPS.

## Luong chay

```text
Web UI / Vercel API
  -> POST /api/tiktok/comment/playwright
  -> Browser Worker /tiktok/comment
  -> TikTok Web
```

## Deploy Render.com

Tao `Web Service` moi tu repo nay, sau do cau hinh:

```text
Build Command:
pip install -r requirements.txt && python -m playwright install chromium chromium-headless-shell

Start Command:
python tiktok_playwright_worker.py
```

Repo da co san `render.yaml`, nen co the tao service bang Blueprint tren Render. Neu tao thu cong thi dung dung command o tren. Khong them `--with-deps` tren Render Free vi lenh do can quyen root va se fail.

Environment Variables tren Render:

```env
WORKER_API_KEY=doi_thanh_chuoi_bi_mat_dai
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_TIMEOUT_MS=90000
PLAYWRIGHT_USER_DATA_DIR=/opt/render/project/src/data/playwright/tiktok-worker-profile
TIKTOK_COOKIE=dan_cookie_tiktok_header_string_o_day_neu_dung_render
```

Sau khi Render co URL, vi du `https://lead-hunter-worker.onrender.com`, them vao backend Vercel:

```env
TIKTOK_PLAYWRIGHT_WORKER_URL=https://lead-hunter-worker.onrender.com
TIKTOK_PLAYWRIGHT_WORKER_KEY=doi_thanh_chuoi_bi_mat_dai
TIKTOK_PLAYWRIGHT_TIMEOUT_MS=90000
```

Redeploy backend Vercel sau khi them env.

## Test worker

Kiem tra worker song:

```powershell
curl https://lead-hunter-worker.onrender.com/health
```

Gui thu mot comment:

```powershell
$headers = @{ "Authorization" = "Bearer doi_thanh_chuoi_bi_mat_dai" }
$body = @{
  url = "https://www.tiktok.com/@username/video/1234567890123456789"
  message = "Em da nhan thong tin a."
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://lead-hunter-worker.onrender.com/tiktok/comment" -Headers $headers -ContentType "application/json" -Body $body
```

## Luu y thuc te

- Render free co the ngu sau mot luc khong dung, lan dau goi se cham.
- TikTok co the chan headless/captcha. Neu can on dinh hon cho khach, dung VPS/mini PC chay Chrome co giao dien va profile dang nhap san.
- Worker co gang tim comment theo noi dung roi bam `Reply`; neu TikTok doi giao dien, worker co the gui thanh comment chung cua video thay vi reply dung thread.
- Khong day `WORKER_API_KEY`, cookie TikTok, hoac file profile Chrome len git.
