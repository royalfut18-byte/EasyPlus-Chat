import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: any) {
          cookiesToSet.forEach(({ name, value, options }: any) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isPublicAsset =
    request.nextUrl.pathname === '/manifest.webmanifest' ||
    request.nextUrl.pathname === '/api/models'

  const finalizeResponse = (response: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...options }) => {
      response.cookies.set(name, value, options)
    })
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return response
  }

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/signup') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !isPublicAsset &&
    request.nextUrl.pathname !== '/'
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return finalizeResponse(NextResponse.redirect(url))
  }

  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/chat'
    return finalizeResponse(NextResponse.redirect(url))
  }

  // Normal (non-redirect) navigations: the refreshed auth cookies are already
  // on supabaseResponse. Return it WITHOUT the no-store header so the Next.js
  // client Router Cache can keep visited pages and make navigation feel instant.
  // The middleware still runs on every real navigation, so auth stays enforced.
  return supabaseResponse
}
