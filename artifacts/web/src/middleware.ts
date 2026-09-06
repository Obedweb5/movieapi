import { clerkMiddleware } from "@clerk/nextjs/server";

// Auth on protected data is enforced by the API server itself (via bearer
// tokens — see providers.tsx), so this middleware only needs to keep Clerk's
// session state in sync; it doesn't gate any Next.js routes.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
