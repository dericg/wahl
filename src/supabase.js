import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isCloudConfigured = Boolean(url && key);
export const supabase = isCloudConfigured ? createClient(url, key) : null;
