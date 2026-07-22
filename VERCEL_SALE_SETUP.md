# Deploy ban Sale F-Solution tren Vercel

Dung cung repo `quantrinhansu123/seedingfacebook` de ban Seeding va ban Sale luon nhan cung mot bo ban va sua loi.

## Tao project Vercel moi

1. Import lai repo `quantrinhansu123/seedingfacebook` thanh mot project Vercel moi.
2. Dat ten project, vi du: `sale-fsolution`.
3. Dat **Root Directory** la `web`.
4. Them cac Environment Variables cho Production, Preview va Development:

```text
NEXT_PUBLIC_APP_EDITION=sale
API_PROXY_BASE_URL=https://seeding-fb.onrender.com
```

5. Deploy project.

Ban Sale se co ten `Sale F-Solution`. Project Seeding cu khong dat `NEXT_PUBLIC_APP_EDITION` nen van giu nguyen giao dien va ten hien tai.

## Du lieu va dang nhap

Hai frontend dang dung chung backend `seeding-fb.onrender.com`, vi vay tai khoan, lead, kenh va lich su duoc dong bo. Neu can tach du lieu Sale thanh he thong doc lap thi can tao backend va Supabase rieng, sau do doi `API_PROXY_BASE_URL` cua project Sale.
