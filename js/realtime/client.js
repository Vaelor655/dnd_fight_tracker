import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function isConfigured(){
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.startsWith("http"));
}

export function getSupabase(){
  if(!isConfigured()) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
