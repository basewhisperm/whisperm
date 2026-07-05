import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/',
  '/api/marketplace-acquisition/notifications/webhook',
  // ST1-011: the seller claim portal is reached by sellers clicking a WhatsApp/SMS link,
  // so it must be reachable without a WhisperM session. The route lives at /claim/[token]
  // (not /marketplace-acquisition/claim), with its API under /api/marketplace-acquisition/claims.
  '/claim(.*)',
  '/api/marketplace-acquisition/claims(.*)',
]);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
