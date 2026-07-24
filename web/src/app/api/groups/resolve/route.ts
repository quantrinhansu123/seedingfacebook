import { NextRequest, NextResponse } from 'next/server';

const NUMERIC_SLUG = /^\d{6,}$/;

function resolveBackendBase(): string {
  let base = (process.env.API_PROXY_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();
  if (base.toLowerCase().endsWith('/api')) {
    base = base.slice(0, -4);
  }
  base = base.replace(/\/$/, '');
  if (base && !base.includes('seeding-beta.vercel.app') && !base.includes('fb-moni.vercel.app')) {
    return base;
  }
  if (process.env.NODE_ENV === 'development') {
    return 'http://127.0.0.1:5000';
  }
  return 'https://seedingfacebook.onrender.com';
}

export async function GET(request: NextRequest) {
  const slug = (request.nextUrl.searchParams.get('slug') || '').trim().replace(/\/$/, '');
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'Thiếu slug' }, { status: 400 });
  }

  if (NUMERIC_SLUG.test(slug)) {
    return NextResponse.json({
      ok: true,
      id: slug,
      name: slug,
      is_member: null,
      source: 'numeric-id',
    });
  }

  const backendUrl = `${resolveBackendBase()}/api/groups/resolve?slug=${encodeURIComponent(slug)}`;
  const cookie = request.headers.get('cookie');
  try {
    const res = await fetch(backendUrl, {
      headers: cookie ? { cookie } : undefined,
      cache: 'no-store',
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không gọi được backend';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
