/**
 * Ascent Nation List (ANL) - Configuration
 * 
 * 1. SUPABASE CREDENTIALS:
 *    Found in your Supabase Dashboard -> Project Settings -> API:
 *    - Project URL  -> SUPABASE_URL
 *    - anon public  -> SUPABASE_ANON_KEY
 * 
 * 2. COMMUNITY LINKS:
 *    Paste your community's official Discord invite and YouTube channel URL below.
 */

// --- 1. Supabase API Settings ---
const SUPABASE_URL = "https://nrcbqlyfwnbftpxlygzh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yY2JxbHlmd25iZnRweGx5Z3poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTc1MzIsImV4cCI6MjEwODQzMzUzMn0.t7h70vvBIrZsLWpDxKFj3jCwu_VLzms_J-v3lDNzfWg";

// --- 2. Community & Social Media Links ---
const COMMUNITY_CONFIG = {
  discordUrl: "https://discord.gg/ascentnation",       // Replace with your Discord invite
  youtubeUrl: "https://youtube.com/@ascentnation",     // Replace with your YouTube channel
  maxPendingSubmissions: 3                             // Submission queue limit per user
};

// --- 3. Auto-populate Navbar Links ---
document.addEventListener("DOMContentLoaded", () => {
  const discordBtn = document.getElementById("discordLink");
  const ytBtn = document.getElementById("ytLink");

  if (discordBtn && COMMUNITY_CONFIG.discordUrl) {
    discordBtn.href = COMMUNITY_CONFIG.discordUrl;
  }
  
  if (ytBtn && COMMUNITY_CONFIG.youtubeUrl) {
    ytBtn.href = COMMUNITY_CONFIG.youtubeUrl;
  }
});