let currentLevels = [];
let currentTab = "main";
let selectedLevelId = null;
let currentUser = null;
let currentModerator = null;

// Helper: Validate username format (letters, numbers, underscores, 3-20 chars)
function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

// Helper: Maps a username to an internal pseudo-email for Supabase Auth
function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@anl-player.com`;
}

// Helper: Validate and ensure URLs strictly use http or https (prevent javascript: XSS)
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

// Helper: Escape HTML to prevent injection
function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

// Points calculation
function calculatePoints(rank) {
  if (!rank || rank > SETTINGS.mainListCutoff || rank < 1) return 0;
  const pts = 350 * Math.pow(55 / 350, (rank - 1) / 24);
  return parseFloat(pts.toFixed(2));
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

// Setup delegated events (avoids inline onclick attribute injections)
function setupDelegatedEvents() {
  const detailsPane = document.getElementById("levelDetails");
  detailsPane.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-victor-btn");
    if (btn && btn.dataset.victorId) {
      await deleteVictor(btn.dataset.victorId);
    }
  });
}

// Check if user has an active session and if they are a moderator
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

  const profileBtn = document.getElementById("profileTabBtn");
  if (profileBtn) profileBtn.style.display = "inline-block";

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

  document.getElementById("profileTabBtn").style.display = "none";
  document.getElementById("adminTabBtn").style.display = "none";

  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = "Sign In / Register";
  authBtn.onclick = () => {
    document.getElementById("authModal").classList.add("active");
  };
}

// Fetch Levels and Victors using explicit foreign key
async function fetchLevelsFromDB() {
  const { data, error } = await supabaseClient
    .from('levels')
    .select(`
      id, rank, name, creator, verifier, video_url, description,
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

// Calculate Player Stats across all records
function calculateAllPlayerStats() {
  const playerStats = {};

  currentLevels.forEach(level => {
    const basePts = calculatePoints(level.rank);

    // Credit Verifier
    if (level.verifier) {
      const vName = level.verifier.trim();
      if (!playerStats[vName]) {
        playerStats[vName] = { points: 0, completions: 0, verifications: 0, beatenLevels: [], verifiedLevels: [] };
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

    // Credit Victors
    if (level.victors) {
      level.victors.forEach(victor => {
        const pName = (victor.player_name || '').trim();
        if (!pName) return;
        if (!playerStats[pName]) {
          playerStats[pName] = { points: 0, completions: 0, verifications: 0, beatenLevels: [], verifiedLevels: [] };
        }
        playerStats[pName].points += basePts;
        playerStats[pName].completions += 1;
        playerStats[pName].beatenLevels.push({
          id: level.id,
          rank: level.rank,
          name: level.name,
          device: victor.device,
          proof_url: victor.proof_url,
          points: basePts
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
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td style="color: var(--accent); font-weight:700;">${p.points.toFixed(2)}</td>
      <td>${p.completions}</td>
      <td>${p.verifications}</td>
    </tr>
  `).join("");
}

// Render User Profile
function renderProfile() {
  if (!currentUser) return;

  const currentName = (currentUser.user_metadata?.player_name || "").trim();
  document.getElementById("profilePlayerName").textContent = currentName || "Player";
  document.getElementById("profileAvatar").textContent = (currentName.charAt(0) || "?").toUpperCase();
  document.getElementById("updatePlayerNameInput").value = currentName;

  const allStats = calculateAllPlayerStats();
  const userStats = allStats.find(p => p.name.toLowerCase() === currentName.toLowerCase());

  if (userStats) {
    document.getElementById("profileRankText").textContent = `#${userStats.rank}`;
    document.getElementById("profileTotalPoints").textContent = `${userStats.points.toFixed(2)} pts`;
    document.getElementById("profileCompletions").textContent = userStats.completions;
    document.getElementById("profileVerifications").textContent = userStats.verifications;

    // Render Completions
    const beatenContainer = document.getElementById("profileCompletedList");
    if (userStats.beatenLevels.length > 0) {
      beatenContainer.innerHTML = userStats.beatenLevels.sort((a, b) => a.rank - b.rank).map(lvl => {
        const validatedUrl = safeUrl(lvl.proof_url);
        return `
          <div class="profile-level-row">
            <div>
              <strong>#${lvl.rank} - ${escapeHtml(lvl.name)}</strong>
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
      beatenContainer.innerHTML = `<p class="text-muted">No completed levels recorded yet.</p>`;
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
    document.getElementById("profileVerifications").textContent = "0";

    document.getElementById("profileCompletedList").innerHTML = `
      <p class="text-muted">No records currently match "<strong>${escapeHtml(currentName)}</strong>".</p>
    `;
    document.getElementById("profileVerifiedList").innerHTML = `
      <p class="text-muted">No verified levels found.</p>
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
  const verifierBonus = (points * SETTINGS.verifierBonusPct).toFixed(2);
  const totalVerifierPts = (points * (1 + SETTINGS.verifierBonusPct)).toFixed(2);
  const embedUrl = getYouTubeEmbedUrl(level.video_url);

  container.innerHTML = `
    <div class="level-header">
      <div class="level-title-group">
        <h2>#${level.rank} - ${escapeHtml(level.name)}</h2>
        <p>Created by <strong>${escapeHtml(level.creator)}</strong> | Verified by <strong>${escapeHtml(level.verifier)}</strong></p>
      </div>
      <div class="points-pill">
        ${points > 0 ? `${points.toFixed(2)} pts` : "0.00 pts (Extended)"}
      </div>
    </div>

    <div class="video-wrapper">
      ${embedUrl ? `<iframe src="${embedUrl}" title="YouTube verification video" allowfullscreen></iframe>` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">No valid video available</div>`}
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span>Verifier Bonus</span>
        <strong>${points > 0 ? `+${verifierBonus} pts (${totalVerifierPts} total)` : '0 pts'}</strong>
      </div>
      <div class="stat-card">
        <span>Total Victors</span>
        <strong>${level.victors ? level.victors.length : 0} Victor(s)</strong>
      </div>
      <div class="stat-card">
        <span>Description</span>
        <strong style="font-size:0.85rem; font-weight: normal;">${escapeHtml(level.description || "No description provided.")}</strong>
      </div>
    </div>

    <div class="victors-card">
      <h3>Approved 100% Records</h3>
      <div class="victor-list">
        ${level.victors && level.victors.length > 0 ? level.victors.map(v => {
          const validProof = safeUrl(v.proof_url);
          return `
            <div class="victor-row">
              <span><strong>${escapeHtml(v.player_name)}</strong> (${escapeHtml(v.device || 'PC')})</span>
              <div>
                ${validProof ? `<a href="${validProof}" target="_blank" rel="noopener noreferrer">Proof</a>` : ''}
                ${currentModerator ? `<button type="button" class="delete-victor-btn" data-victor-id="${escapeHtml(v.id)}">✕ Delete</button>` : ''}
              </div>
            </div>
          `;
        }).join("") : `<p style="color: var(--text-muted); padding: 8px 0;">No victors yet.</p>`}
      </div>
    </div>
  `;
}

// Setup Admin & Profile forms
function setupForms() {
  // Update Display Name Form
  document.getElementById("updateNameForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = document.getElementById("updatePlayerNameInput").value.trim();

    if (!isValidUsername(newName)) {
      alert("Invalid format: Usernames must be 3-20 characters long and contain only letters, numbers, or underscores.");
      return;
    }

    const { data: existingUser } = await supabaseClient
      .from('profiles')
      .select('id')
      .ilike('username', newName)
      .neq('id', currentUser.id)
      .maybeSingle();

    if (existingUser) {
      alert("This player name is already reserved by another account.");
      return;
    }

    const { data, error } = await supabaseClient.auth.updateUser({
      data: { player_name: newName }
    });

    if (error) {
      alert("Error updating name: " + error.message);
    } else {
      currentUser = data.user;
      alert(`In-game name updated to "${newName}"!`);
      setLoggedInState();
    }
  });

  // Add Victor Form
  document.getElementById("addVictorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentModerator) {
      alert("Unauthorized: Only moderators can add records.");
      return;
    }

    const levelId = document.getElementById("victorLevelSelect").value;
    const playerName = document.getElementById("victorPlayerName").value.trim();
    const rawProof = document.getElementById("victorProofUrl").value.trim();
    const validatedProof = safeUrl(rawProof);
    const device = document.getElementById("victorDevice").value.trim();

    if (!validatedProof) {
      alert("Please provide a valid HTTP or HTTPS proof link.");
      return;
    }

    const { error } = await supabaseClient.from('victors').insert([
      { level_id: levelId, player_name: playerName, proof_url: validatedProof, device: device, percentage: 100 }
    ]);

    if (error) {
      alert("Database error: " + error.message);
    } else {
      alert(`Victor record added for ${playerName}!`);
      document.getElementById("addVictorForm").reset();
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

    // Attempt RPC shift first; fallback to direct insert if RPC is not installed
    const { error: rpcError } = await supabaseClient.rpc('insert_level_shift', {
      p_rank: rank,
      p_name: name,
      p_creator: creator,
      p_verifier: verifier,
      p_video: validatedVideo,
      p_desc: description
    });

    if (rpcError) {
      const rankTaken = currentLevels.some(l => l.rank === rank);
      if (rankTaken) {
        alert(`Rank #${rank} is already assigned. Please resolve or shift ranks in the database first.`);
        return;
      }

      const { error: insertError } = await supabaseClient.from('levels').insert([
        { rank, name, creator, verifier, video_url: validatedVideo, description }
      ]);

      if (insertError) {
        alert("Error adding level: " + insertError.message);
        return;
      }
    }

    alert(`Level ${name} successfully placed at #${rank}!`);
    document.getElementById("addLevelForm").reset();
    await fetchLevelsFromDB();
  });
}

// Delete Victor (Moderators only)
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

// Populate Admin dropdown
function populateAdminDropdown() {
  const select = document.getElementById("victorLevelSelect");
  if (!select) return;
  select.innerHTML = currentLevels.map(lvl => `
    <option value="${escapeHtml(lvl.id)}">#${lvl.rank} - ${escapeHtml(lvl.name)}</option>
  `).join("");
}

// Navigation Tab switcher
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

  // Sign In submit
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

  // Sign Up submit
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("signupUsername").value.trim();
    const password = document.getElementById("signupPassword").value;

    if (!isValidUsername(username)) {
      errorEl.textContent = "Usernames must be 3-20 characters long and contain only alphanumeric characters or underscores.";
      return;
    }

    const pseudoEmail = usernameToEmail(username);
    errorEl.textContent = "Creating account...";

    const { data, error } = await supabaseClient.auth.signUp({
      email: pseudoEmail,
      password: password,
      options: {
        data: {
          player_name: username
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