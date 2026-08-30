import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/',
  // ST1-013L: readiness/health checks are polled by load balancers, uptime monitors, and CI --
  // they cannot present a Clerk session, so this route must stay public. It never returns
  // tenant data, only process/database liveness.
  '/api/health',
  // Vercel Cron has no Clerk session. The handler authenticates the scheduler with
  // CRON_SECRET and fails closed before touching queue state.
  '/api/internal/queue-drain',
  '/api/marketplace-acquisition/notifications/webhook',
  // ST1-011: the seller claim portal is reached by sellers clicking a WhatsApp/SMS link,
  // so it must be reachable without a WhisperM session. The route lives at /claim/[token]
  // (not /marketplace-acquisition/claim), with its API under /api/marketplace-acquisition/claims.
  '/claim(.*)',
  '/api/marketplace-acquisition/claims(.*)',
]);

// These routes authenticate with a machine secret or a public claim token and
// must remain reachable even when Clerk itself is unavailable. Browser-facing
// public routes still pass through Clerk so server auth() and ClerkProvider
// receive the request context they require.
const isClerkBypassRoute = createRouteMatcher([
  '/api/health',
  '/api/internal/queue-drain',
  '/api/marketplace-acquisition/notifications/webhook',
  '/claim(.*)',
  '/api/marketplace-acquisition/claims(.*)',
]);

const protectedMiddleware = clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) auth().protect();
});

/**
 * Public machine and seller routes must bypass Clerk entirely. Marking them
 * public only inside clerkMiddleware still initializes Clerk for the request;
 * an unavailable Clerk runtime then crashes before the route handler can
 * validate CRON_SECRET or return health state.
 */
export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (isClerkBypassRoute(request)) return NextResponse.next();
  return protectedMiddleware(request, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
