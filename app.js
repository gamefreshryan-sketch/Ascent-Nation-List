let currentLevels = [];
let currentTab = "main";
let selectedLevelId = null;
let currentUser = null;
let currentModerator = null;
let activeProfilePlayer = null; // When viewing another player's profile
let currentProfileSort = "rank"; // 'rank', 'points', 'pct', 'name'

// Helper: Validate username format
function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

// Helper: Internal pseudo-email for Supabase Auth
function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@anl-player.com`;
}

// Helper: Ensure URLs strictly use HTTP or HTTPS protocols
function safeUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl.trim(), window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return escapeHtml(parsed.href);
    }
  } catch (_) {}
  return '';
}

// Helper: Convert standard YouTube links into safe embed URLs
function getYouTubeEmbedUrl(url) {
  if (!url) return '';
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : '';
}

// Helper: Escape HTML entities
function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

// Base points calculation for 100% completion
function calculatePoints(rank) {
  if (!rank || rank > SETTINGS.mainListCutoff || rank < 1) return 0;
  const pts = 350 * Math.pow(55 / 350, (rank - 1) / 24);
  return parseFloat(pts.toFixed(2));
}

// Progressive points calculation:
// 100% gives full points.
// Min Requirement % gives 10% points, scaling linearly up to 50% at 99%.
function calculatePointsForRecord(rank, percentage, minReq = 100) {
  const basePts = calculatePoints(rank);
  if (basePts === 0) return 0;

  const pct = Math.min(100, Math.max(0, parseInt(percentage, 10) || 100));
  const minPercent = Math.min(100, Math.max(1, parseInt(minReq, 10) || 100));

  if (pct === 100) {
    return basePts;
  }

  if (pct >= minPercent && minPercent < 100) {
    const progressRatio = (pct - minPercent) / (100 - minPercent);
    const multiplier = 0.10 + (0.40 * progressRatio);
    return parseFloat((basePts * multiplier).toFixed(2));
  }

  return 0;
}

// Startup
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("discordLink").href = safeUrl(SETTINGS.discordUrl) || '#';
  document.getElementById("ytLink").href = safeUrl(SETTINGS.youtubeUrl) || '#';

  setupNavigation();
  setupSearch();
  setupAuth();
  setupForms();
  setupDelegatedEvents();

  await checkAuthSession();
  await fetchLevelsFromDB();
});

// Setup click delegation for player links, profile sorting, and deletion
function setupDelegatedEvents() {
  document.addEventListener("click", async (e) => {
    // 1. Player link clicked (e.g. in Leaderboard or Victors)
    const playerLink = e.target.closest(".player-link");
    if (playerLink && playerLink.dataset.player) {
      e.preventDefault();
      openPlayerProfile(playerLink.dataset.player);
      return;
    }

    // 2. Return to own profile button
    if (e.target.id === "viewMyProfileBtn") {
      activeProfilePlayer = null;
      renderProfile();
      return;
    }

    // 3. Profile record sort buttons
    const sortBtn = e.target.closest(".sort-btn");
    if (sortBtn && sortBtn.dataset.sort) {
      document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
      sortBtn.classList.add("active");
      currentProfileSort = sortBtn.dataset.sort;
      renderProfile();
      return;
    }

    // 4. Delete record button
    const delBtn = e.target.closest(".delete-victor-btn");
    if (delBtn && delBtn.dataset.victorId) {
      await deleteVictor(delBtn.dataset.victorId);
      return;
    }
  });
}

// Switch to profile view focusing on a specific player
function openPlayerProfile(playerName) {
  activeProfilePlayer = playerName.trim();

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  const profileBtn = document.getElementById("profileTabBtn");
  if (profileBtn) profileBtn.classList.add("active");

  const profileView = document.getElementById("profileView");
  if (profileView) profileView.classList.add("active");

  currentTab = "profile";
  renderProfile();
}

// Check session & moderator status
async function checkAuthSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;

    const { data: mod } = await supabaseClient
      .from('moderators')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    currentModerator = mod ? currentUser : null;
    setLoggedInState();
  } else {
    setLoggedOutState();
  }
}

function setLoggedInState() {
  const playerName = currentUser.user_metadata?.player_name || "Player";

  const adminBtn = document.getElementById("adminTabBtn");
  if (adminBtn) adminBtn.style.display = currentModerator ? "inline-block" : "none";

  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = `Logout (${playerName})`;
  authBtn.onclick = async () => {
    await supabaseClient.auth.signOut();
    location.reload();
  };

  renderProfile();
}

function setLoggedOutState() {
  currentUser = null;
  currentModerator = null;

  document.getElementById("adminTabBtn").style.display = "none";

  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = "Sign In / Register";
  authBtn.onclick = () => {
    document.getElementById("authModal").classList.add("active");
  };

  renderProfile();
}

// Fetch Levels and Victors
async function fetchLevelsFromDB() {
  const { data, error } = await supabaseClient
    .from('levels')
    .select(`
      *,
      victors!fk_victors_levels ( id, player_name, percentage, proof_url, device )
    `)
    .order('rank', { ascending: true });

  if (error) {
    console.error("Error fetching levels:", error);
    document.getElementById("levelList").innerHTML = `
      <div style="padding: 20px; color: var(--danger);">Failed to load levels: ${escapeHtml(error.message)}</div>
    `;
    return;
  }

  currentLevels = data || [];
  renderList();
  renderLeaderboard();
  renderProfile();
  populateAdminDropdown();
}

// Calculate comprehensive player stats
function calculateAllPlayerStats() {
  const playerStats = {};

  currentLevels.forEach(level => {
    const basePts = calculatePoints(level.rank);
    const minReq = level.min_percentage ? parseInt(level.min_percentage, 10) : 100;

    // Credit Verifier
    if (level.verifier) {
      const vName = level.verifier.trim();
      if (!playerStats[vName]) {
        playerStats[vName] = {
          points: 0,
          completions: 0,
          progressions: 0,
          verifications: 0,
          beatenLevels: [],
          verifiedLevels: []
        };
      }
      const verifierPts = basePts * (1 + SETTINGS.verifierBonusPct);
      playerStats[vName].points += verifierPts;
      playerStats[vName].verifications += 1;
      playerStats[vName].verifiedLevels.push({
        id: level.id,
        rank: level.rank,
        name: level.name,
        creator: level.creator,
        points: verifierPts
      });
    }

    // Credit Victors & Qualifying Progress
    if (level.victors) {
      level.victors.forEach(victor => {
        const pName = (victor.player_name || '').trim();
        if (!pName) return;

        const pct = parseInt(victor.percentage, 10) || 100;
        if (pct < minReq) return; // Disregard records below requirement

        if (!playerStats[pName]) {
          playerStats[pName] = {
            points: 0,
            completions: 0,
            progressions: 0,
            verifications: 0,
            beatenLevels: [],
            verifiedLevels: []
          };
        }

        const earnedPoints = calculatePointsForRecord(level.rank, pct, minReq);
        playerStats[pName].points += earnedPoints;

        if (pct === 100) {
          playerStats[pName].completions += 1;
        } else {
          playerStats[pName].progressions += 1;
        }

        playerStats[pName].beatenLevels.push({
          id: level.id,
          rank: level.rank,
          name: level.name,
          device: victor.device,
          proof_url: victor.proof_url,
          points: earnedPoints,
          percentage: pct,
          isCompletion: pct === 100
        });
      });
    }
  });

  const sorted = Object.entries(playerStats)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.points - a.points);

  sorted.forEach((p, idx) => {
    p.rank = idx + 1;
  });

  return sorted;
}

// Render Leaderboard
function renderLeaderboard() {
  const sorted = calculateAllPlayerStats();
  const tbody = document.getElementById("leaderboardBody");
  tbody.innerHTML = sorted.map((p) => `
    <tr>
      <td><strong>#${p.rank}</strong></td>
      <td>
        <a href="#" class="player-link" data-player="${escapeHtml(p.name)}">${escapeHtml(p.name)}</a>
      </td>
      <td style="color: var(--accent); font-weight:700;">${p.points.toFixed(2)}</td>
      <td>${p.completions}</td>
      <td>${p.progressions}</td>
      <td>${p.verifications}</td>
    </tr>
  `).join("");
}

// Render User or Selected Player Profile
function renderProfile() {
  const allStats = calculateAllPlayerStats();

  let targetPlayerName = activeProfilePlayer;
  const isViewingSelf = !activeProfilePlayer || (
    currentUser && currentUser.user_metadata?.player_name?.toLowerCase() === activeProfilePlayer.toLowerCase()
  );

  if (!targetPlayerName) {
    if (currentUser) {
      targetPlayerName = currentUser.user_metadata?.player_name || "";
    } else {
      targetPlayerName = allStats.length > 0 ? allStats[0].name : "Player";
    }
  }

  // Handle return toolbar
  const toolbar = document.getElementById("profileToolbar");
  if (currentUser && !isViewingSelf) {
    toolbar.style.display = "block";
  } else {
    toolbar.style.display = "none";
  }

  // Handle Bio Edit Card
  const bioEditCard = document.getElementById("bioEditCard");
  if (currentUser && isViewingSelf) {
    bioEditCard.style.display = "block";
    document.getElementById("updateBioInput").value = currentUser.user_metadata?.bio || "";
  } else {
    bioEditCard.style.display = "none";
  }

  // Bio Display
  const bioDisplay = document.getElementById("profileBioDisplay");
  if (isViewingSelf && currentUser) {
    bioDisplay.textContent = currentUser.user_metadata?.bio || "No personal bio written yet.";
  } else {
    bioDisplay.textContent = `Showing Ascent Nation public profile for ${targetPlayerName}.`;
  }

  document.getElementById("profilePlayerName").textContent = targetPlayerName;
  document.getElementById("profileAvatar").textContent = (targetPlayerName.charAt(0) || "?").toUpperCase();
  document.getElementById("profileBadge").textContent = isViewingSelf && currentUser ? "My Account" : "Player";

  const userStats = allStats.find(p => p.name.toLowerCase() === targetPlayerName.toLowerCase());

  if (userStats) {
    document.getElementById("profileRankText").textContent = `#${userStats.rank}`;
    document.getElementById("profileTotalPoints").textContent = `${userStats.points.toFixed(2)} pts`;
    document.getElementById("profileCompletions").textContent = userStats.completions;
    document.getElementById("profileProgressions").textContent = userStats.progressions;
    document.getElementById("profileVerifications").textContent = userStats.verifications;

    // Sort beaten/progress levels according to selected sort
    const records = [...userStats.beatenLevels];
    if (currentProfileSort === "rank") {
      records.sort((a, b) => a.rank - b.rank);
    } else if (currentProfileSort === "points") {
      records.sort((a, b) => b.points - a.points);
    } else if (currentProfileSort === "pct") {
      records.sort((a, b) => b.percentage - a.percentage);
    } else if (currentProfileSort === "name") {
      records.sort((a, b) => a.name.localeCompare(b.name));
    }

    const beatenContainer = document.getElementById("profileCompletedList");
    if (records.length > 0) {
      beatenContainer.innerHTML = records.map(lvl => {
        const validatedUrl = safeUrl(lvl.proof_url);
        return `
          <div class="profile-level-row">
            <div>
              <strong>#${lvl.rank} - ${escapeHtml(lvl.name)}</strong>
              <span class="pct-badge ${lvl.isCompletion ? 'pct-100' : 'pct-partial'}">${lvl.percentage}%</span>
              <span class="text-muted" style="font-size: 0.8rem; margin-left: 8px;">(${escapeHtml(lvl.device || 'PC')})</span>
            </div>
            <div style="display: flex; gap: 12px; align-items: center;">
              <span style="color: var(--accent); font-weight: 600;">+${lvl.points.toFixed(2)} pts</span>
              ${validatedUrl ? `<a href="${validatedUrl}" target="_blank" rel="noopener noreferrer">Proof</a>` : ''}
            </div>
          </div>
        `;
      }).join("");
    } else {
      beatenContainer.innerHTML = `<p class="text-muted">No completed or qualifying progress records found.</p>`;
    }

    // Render Verifications
    const verifiedContainer = document.getElementById("profileVerifiedList");
    if (userStats.verifiedLevels.length > 0) {
      verifiedContainer.innerHTML = userStats.verifiedLevels.sort((a, b) => a.rank - b.rank).map(lvl => `
        <div class="profile-level-row">
          <div>
            <strong>#${lvl.rank} - ${escapeHtml(lvl.name)}</strong>
            <span class="text-muted" style="font-size: 0.8rem; margin-left: 8px;">by ${escapeHtml(lvl.creator)}</span>
          </div>
          <span style="color: var(--accent-gold); font-weight: 600;">+${lvl.points.toFixed(2)} pts</span>
        </div>
      `).join("");
    } else {
      verifiedContainer.innerHTML = `<p class="text-muted">No verified levels.</p>`;
    }

  } else {
    document.getElementById("profileRankText").textContent = "Unranked";
    document.getElementById("profileTotalPoints").textContent = "0.00 pts";
    document.getElementById("profileCompletions").textContent = "0";
    document.getElementById("profileProgressions").textContent = "0";
    document.getElementById("profileVerifications").textContent = "0";

    document.getElementById("profileCompletedList").innerHTML = `
      <p class="text-muted">No list records found for "<strong>${escapeHtml(targetPlayerName)}</strong>".</p>
    `;
    document.getElementById("profileVerifiedList").innerHTML = `
      <p class="text-muted">No verified levels.</p>
    `;
  }
}

// Render Level List
function renderList() {
  const listContainer = document.getElementById("levelList");
  listContainer.innerHTML = "";

  const query = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
  const isMain = currentTab === "main";

  let filtered = currentLevels.filter(lvl => 
    isMain ? lvl.rank <= SETTINGS.mainListCutoff : lvl.rank > SETTINGS.mainListCutoff
  );

  if (query) {
    filtered = filtered.filter(lvl =>
      lvl.name.toLowerCase().includes(query) ||
      lvl.creator.toLowerCase().includes(query) ||
      (lvl.verifier && lvl.verifier.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    listContainer.innerHTML = `<div style="padding: 20px; color: var(--text-muted);">No levels found.</div>`;
    document.getElementById("levelDetails").innerHTML = `<div class="loading">No level selected.</div>`;
    return;
  }

  let selected = filtered.find(l => l.id === selectedLevelId);
  if (!selected) {
    selected = filtered[0];
    selectedLevelId = selected.id;
  }

  filtered.forEach((level) => {
    const item = document.createElement("div");
    item.className = `level-item ${level.id === selectedLevelId ? "active" : ""}`;
    item.innerHTML = `
      <div class="item-rank">#${level.rank}</div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(level.name)}</div>
        <div class="item-author">by ${escapeHtml(level.creator)}</div>
      </div>
    `;

    item.addEventListener("click", () => {
      selectedLevelId = level.id;
      renderList();
    });

    listContainer.appendChild(item);
  });

  renderLevelDetails(selected);
}

// Render Level Details
function renderLevelDetails(level) {
  const container = document.getElementById("levelDetails");
  if (!level) {
    container.innerHTML = `<div class="loading">Select a level...</div>`;
    return;
  }

  const points = calculatePoints(level.rank);
  const minReq = level.min_percentage ? parseInt(level.min_percentage, 10) : 100;
  const lengthStr = level.length || "N/A";
  const verifierBonus = (points * SETTINGS.verifierBonusPct).toFixed(2);
  const totalVerifierPts = (points * (1 + SETTINGS.verifierBonusPct)).toFixed(2);
  const embedUrl = getYouTubeEmbedUrl(level.video_url);

  container.innerHTML = `
    <div class="level-header">
      <div class="level-title-group">
        <h2>#${level.rank} - ${escapeHtml(level.name)}</h2>
        <p>
          Created by <strong>${escapeHtml(level.creator)}</strong> | 
          Verified by <a href="#" class="player-link" data-player="${escapeHtml(level.verifier)}"><strong>${escapeHtml(level.verifier)}</strong></a>
        </p>
      </div>
      <div class="points-pill">
        ${points > 0 ? `${points.toFixed(2)} pts` : "0.00 pts (Extended)"}
      </div>
    </div>

    <div class="video-wrapper">
      ${embedUrl ? `<iframe src="${embedUrl}" title="Verification video" allowfullscreen></iframe>` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">No valid video available</div>`}
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span>Level Length</span>
        <strong>${escapeHtml(lengthStr)}</strong>
      </div>
      <div class="stat-card">
        <span>List Requirement</span>
        <strong style="color: var(--accent);">${minReq}% or better</strong>
      </div>
      <div class="stat-card">
        <span>Verifier Bonus</span>
        <strong>${points > 0 ? `+${verifierBonus} pts (${totalVerifierPts} total)` : '0 pts'}</strong>
      </div>
      <div class="stat-card">
        <span>Total Records</span>
        <strong>${level.victors ? level.victors.length : 0} Record(s)</strong>
      </div>
    </div>

    <div class="stat-card" style="margin-bottom: 24px;">
      <span>Description</span>
      <strong style="font-size:0.85rem; font-weight: normal;">${escapeHtml(level.description || "No description provided.")}</strong>
    </div>

    <div class="victors-card">
      <h3>Approved Records (&ge;${minReq}%)</h3>
      <div class="victor-list">
        ${level.victors && level.victors.length > 0 ? level.victors.map(v => {
          const validProof = safeUrl(v.proof_url);
          const pct = v.percentage || 100;
          return `
            <div class="victor-row">
              <div>
                <a href="#" class="player-link" data-player="${escapeHtml(v.player_name)}"><strong>${escapeHtml(v.player_name)}</strong></a>
                <span class="pct-badge ${pct === 100 ? 'pct-100' : 'pct-partial'}">${pct}%</span>
                <span class="text-muted" style="font-size:0.85rem; margin-left:6px;">(${escapeHtml(v.device || 'PC')})</span>
              </div>
              <div>
                ${validProof ? `<a href="${validProof}" target="_blank" rel="noopener noreferrer">Proof</a>` : ''}
                ${currentModerator ? `<button type="button" class="delete-victor-btn" data-victor-id="${escapeHtml(v.id)}">✕ Delete</button>` : ''}
              </div>
            </div>
          `;
        }).join("") : `<p style="color: var(--text-muted); padding: 8px 0;">No approved records yet.</p>`}
      </div>
    </div>
  `;
}

// Setup Admin & Profile forms
function setupForms() {
  // Update Bio Form
  const bioForm = document.getElementById("updateBioForm");
  if (bioForm) {
    bioForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const newBio = document.getElementById("updateBioInput").value.trim();
      const { data, error } = await supabaseClient.auth.updateUser({
        data: { bio: newBio }
      });

      if (error) {
        alert("Failed to save bio: " + error.message);
      } else {
        currentUser = data.user;
        alert("Personal bio updated!");
        renderProfile();
      }
    });
  }

  // Add Victor Form
  document.getElementById("addVictorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentModerator) {
      alert("Unauthorized: Only moderators can add records.");
      return;
    }

    const levelId = document.getElementById("victorLevelSelect").value;
    const playerName = document.getElementById("victorPlayerName").value.trim();
    const percentage = parseInt(document.getElementById("victorPercentage").value, 10) || 100;
    const rawProof = document.getElementById("victorProofUrl").value.trim();
    const validatedProof = safeUrl(rawProof);
    const device = document.getElementById("victorDevice").value.trim();

    if (!validatedProof) {
      alert("Please provide a valid HTTP or HTTPS proof link.");
      return;
    }

    const { error } = await supabaseClient.from('victors').insert([
      { level_id: levelId, player_name: playerName, percentage: percentage, proof_url: validatedProof, device: device }
    ]);

    if (error) {
      alert("Database error: " + error.message);
    } else {
      alert(`Record added for ${playerName} (${percentage}%)!`);
      document.getElementById("addVictorForm").reset();
      document.getElementById("victorPercentage").value = "100";
      await fetchLevelsFromDB();
    }
  });

  // Add Level Form
  document.getElementById("addLevelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentModerator) {
      alert("Unauthorized: Only moderators can place levels.");
      return;
    }

    const rank = parseInt(document.getElementById("levelRank").value, 10);
    const name = document.getElementById("levelName").value.trim();
    const length = document.getElementById("levelLength").value.trim();
    const minPct = parseInt(document.getElementById("levelMinPct").value, 10) || 100;
    const creator = document.getElementById("levelCreator").value.trim();
    const verifier = document.getElementById("levelVerifier").value.trim();
    const rawVideo = document.getElementById("levelVideo").value.trim();
    const validatedVideo = safeUrl(rawVideo);
    const description = document.getElementById("levelDescription").value.trim();

    if (!rank || rank < 1) {
      alert("Rank must be an integer greater than 0.");
      return;
    }

    if (!validatedVideo) {
      alert("Please enter a valid HTTP or HTTPS video URL.");
      return;
    }

    // Try RPC shift first
    const { error: rpcError } = await supabaseClient.rpc('insert_level_shift', {
      p_rank: rank,
      p_name: name,
      p_creator: creator,
      p_verifier: verifier,
      p_video: validatedVideo,
      p_desc: description,
      p_length: length,
      p_min_pct: minPct
    });

    if (rpcError) {
      const rankTaken = currentLevels.some(l => l.rank === rank);
      if (rankTaken) {
        alert(`Rank #${rank} is already assigned. Please resolve or shift ranks in the database first.`);
        return;
      }

      const { error: insertError } = await supabaseClient.from('levels').insert([
        { 
          rank, 
          name, 
          length, 
          min_percentage: minPct, 
          creator, 
          verifier, 
          video_url: validatedVideo, 
          description 
        }
      ]);

      if (insertError) {
        alert("Error adding level: " + insertError.message);
        return;
      }
    }

    alert(`Level ${name} successfully placed at #${rank}!`);
    document.getElementById("addLevelForm").reset();
    document.getElementById("levelMinPct").value = "100";
    await fetchLevelsFromDB();
  });
}

// Delete Victor (Moderator only)
async function deleteVictor(victorId) {
  if (!currentModerator) {
    alert("Unauthorized.");
    return;
  }

  if (!confirm("Are you sure you want to remove this record?")) return;

  const { error } = await supabaseClient.from('victors').delete().eq('id', victorId);
  if (error) {
    alert("Error deleting record: " + error.message);
  } else {
    await fetchLevelsFromDB();
  }
}

// Populate Admin level selector
function populateAdminDropdown() {
  const select = document.getElementById("victorLevelSelect");
  if (!select) return;
  select.innerHTML = currentLevels.map(lvl => `
    <option value="${escapeHtml(lvl.id)}">#${lvl.rank} - ${escapeHtml(lvl.name)}</option>
  `).join("");
}

// Navigation Tabs
function setupNavigation() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const tab = btn.dataset.tab;
      currentTab = tab;

      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      if (tab === "main" || tab === "extended") {
        document.getElementById("listView").classList.add("active");
        renderList();
      } else if (tab === "leaderboard") {
        document.getElementById("leaderboardView").classList.add("active");
        renderLeaderboard();
      } else if (tab === "profile") {
        document.getElementById("profileView").classList.add("active");
        renderProfile();
      } else if (tab === "rules") {
        document.getElementById("rulesView").classList.add("active");
      } else if (tab === "admin") {
        document.getElementById("adminView").classList.add("active");
      }
    });
  });
}

// Search
function setupSearch() {
  const input = document.getElementById("searchInput");
  input.addEventListener("input", () => {
    renderList();
  });
}

// Username-based Auth Handlers
function setupAuth() {
  const modal = document.getElementById("authModal");
  const closeBtn = document.getElementById("closeAuthModal");
  const tabLoginBtn = document.getElementById("tabLoginBtn");
  const tabSignupBtn = document.getElementById("tabSignupBtn");
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const errorEl = document.getElementById("authError");

  closeBtn.onclick = () => modal.classList.remove("active");

  tabLoginBtn.onclick = () => {
    tabLoginBtn.classList.add("active");
    tabSignupBtn.classList.remove("active");
    loginForm.style.display = "block";
    signupForm.style.display = "none";
    errorEl.textContent = "";
  };

  tabSignupBtn.onclick = () => {
    tabSignupBtn.classList.add("active");
    tabLoginBtn.classList.remove("active");
    loginForm.style.display = "none";
    signupForm.style.display = "block";
    errorEl.textContent = "";
  };

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!isValidUsername(username)) {
      errorEl.textContent = "Usernames may only contain 3-20 letters, numbers, or underscores.";
      return;
    }

    const pseudoEmail = usernameToEmail(username);
    errorEl.textContent = "Signing in...";

    const { error } = await supabaseClient.auth.signInWithPassword({
      email: pseudoEmail,
      password: password
    });

    if (error) {
      errorEl.textContent = "Invalid username or password.";
      return;
    }

    modal.classList.remove("active");
    await checkAuthSession();
    renderList();
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("signupUsername").value.trim();
    const password = document.getElementById("signupPassword").value;

    if (!isValidUsername(username)) {
      errorEl.textContent = "Usernames must be 3-20 characters long and contain only letters, numbers, or underscores.";
      return;
    }

    const pseudoEmail = usernameToEmail(username);
    errorEl.textContent = "Creating account...";

    const { data, error } = await supabaseClient.auth.signUp({
      email: pseudoEmail,
      password: password,
      options: {
        data: {
          player_name: username,
          bio: ""
        }
      }
    });

    if (error) {
      if (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("unique")) {
        errorEl.textContent = "This username is already taken. Please choose another.";
      } else {
        errorEl.textContent = error.message;
      }
      return;
    }

    if (data.session) {
      modal.classList.remove("active");
      await checkAuthSession();
      renderList();
      alert(`Welcome to ANL, ${username}!`);
    } else {
      errorEl.textContent = "Account registered! You can now log in.";
      tabLoginBtn.click();
    }
  });
}