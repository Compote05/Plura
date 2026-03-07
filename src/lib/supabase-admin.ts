import { createClient } from '@supabase/supabase-js';

// Server-side only: Admin client that bypasses RLS.
// NEVER import this from client components.
export const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);
