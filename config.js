const SUPABASE_URL = "https://nrcbqlyfwnbftpxlygzh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yY2JxbHlmd25iZnRweGx5Z3poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTc1MzIsImV4cCI6MjEwODQzMzUzMn0.t7h70vvBIrZsLWpDxKFj3jCwu_VLzms_J-v3lDNzfWg";

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SETTINGS = {
  discordUrl: "discord.gg/bM39HvzXVq",
  youtubeUrl: "https://www.youtube.com/@Ascent_GD",
  mainListCutoff: 50,
  verifierBonusPct: 0.20
};