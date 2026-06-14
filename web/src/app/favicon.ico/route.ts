import { NextResponse } from 'next/server';

export function GET(request: Request) {
  return NextResponse.redirect(new URL('/st-real-logo.jpg', request.url), 307);
}
