// supabase_config.js
// Inicialização do cliente Supabase para a extensão.
// Usamos o build UMD global que define a variável window.supabase.

const SUPABASE_URL = "https://rqootnqtwtcifvzmcadt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxb290bnF0d3RjaWZ2em1jYWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDAxNzEsImV4cCI6MjA5NzExNjE3MX0.CcAwsNxGBkulPvL35k540vDQfosxk_wStkiogpJ9C_Q";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
