/**
 * In-memory rate limiter scoped per route and IP.
 * Includes periodic cleanup to prevent memory leaks.
 */

interface RateLimitInfo {
    count: number;
    lastReset: number;
}

const rateLimits = new Map<string, RateLimitInfo>();

let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanupExpired() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;

    for (const [key, info] of rateLimits.entries()) {
        if (now - info.lastReset > CLEANUP_INTERVAL) {
            rateLimits.delete(key);
        }
    }
}

/**
 * Checks if the request should be rate limited.
 * @param req The incoming Request object (used to extract IP)
 * @param maxRequests Maximum number of requests allowed in the time window
 * @param windowMs The time window in milliseconds (default: 60 seconds)
 * @param routeKey Unique key per route to scope rate limits independently
 * @returns true if the request is ALLOWED, false if it should be REJECTED
 */
export async function checkRateLimit(
    req: Request,
    maxRequests: number = 60,
    windowMs: number = 60000,
    routeKey: string = 'global'
): Promise<boolean> {
    const ipHeader = req.headers.get('x-forwarded-for');
    const ip = ipHeader ? ipHeader.split(',')[0].trim() : (req.headers.get('x-real-ip') || 'unknown-ip');

    const key = `${routeKey}:${ip}`;
    const now = Date.now();

    cleanupExpired();

    const userRateLimit = rateLimits.get(key);

    if (!userRateLimit) {
        rateLimits.set(key, { count: 1, lastReset: now });
        return true;
    }

    if (now - userRateLimit.lastReset > windowMs) {
        userRateLimit.count = 1;
        userRateLimit.lastReset = now;
        return true;
    }

    if (userRateLimit.count >= maxRequests) {
        return false;
    }

    userRateLimit.count++;
    return true;
}
