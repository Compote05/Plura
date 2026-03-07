import { createClient } from '@supabase/supabase-js';

// Create a Supabase client capable of verifying tokens
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Verifies the auth token from the Authorization header ONLY.
 * Returns the Supabase User object if valid.
 */
export async function verifyAuth(req: Request) {
    const authHeader = req.headers.get('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.split(' ')[1];

    // Verify the JWT with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        console.error("Auth verification failed:", error?.message);
        return null;
    }

    return user;
}
