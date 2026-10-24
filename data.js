/**
 * ASCENT NATION LIST (ANL) - DATABASE
 * To add a level: Add a new object to the list array.
 * To add a victor: Add an object to the level's `victors` array.
 */

const ANL_DATA = {
  settings: {
    discordUrl: "https://discord.gg/YaZbWD7z",
    youtubeUrl: "https://www.youtube.com/@ascentgd", // Update with exact handle
    topPoints: 350.0,      // #1 level points
    mainListCutoff: 50,    // Top 50 levels award points
    verifierBonusPct: 0.20 // 20% bonus for verifier
  },
  
  // Levels in exact rank order (Rank 1 is index 0)
  levels: [
    {
      id: 1,
      name: "Flaimwoll",
      creator: "Ascent & M1xxronium",
      verifier: "Ascent",
      verificationVideo: "https://www.youtube.com/embed/dQw4w9WgXcQ", // YouTube Embed Link
      thumbnail: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&auto=format&fit=crop&q=80", // Optional custom image
      description: "Top 1 demon remake of Tartarus/Firework aesthetics. Extremely tight wave timings and ship control.",
      victors: [
        { name: "PlayerOne", percentage: 100, proof: "https://youtube.com", device: "360Hz" },
        { name: "GDMaster", percentage: 100, proof: "https://youtube.com", device: "240Hz" }
      ]
    },
    {
      id: 2,
      name: "Asceron",
      creator: "M1xxronium",
      verifier: "Ascent",
      verificationVideo: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      thumbnail: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80",
      description: "Remake of Acheron. Fast-paced high CPS gameplay built by Ascent Nation.",
      victors: [
        { name: "DashGod", percentage: 100, proof: "https://youtube.com", device: "CBF" }
      ]
    },
    {
      id: 3,
      name: "Larp Circles",
      creator: "Ascent Community",
      verifier: "M1xxronium",
      verificationVideo: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      thumbnail: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=600&auto=format&fit=crop&q=80",
      description: "Nine Circles-inspired extreme demon layout remake.",
      victors: [
        { name: "Xeron", percentage: 100, proof: "https://youtube.com", device: "144Hz" },
        { name: "GeometryPro", percentage: 100, proof: "https://youtube.com", device: "Mobile 120Hz" }
      ]
    }
    // To add more levels, just duplicate one of the blocks above!
  ]
};