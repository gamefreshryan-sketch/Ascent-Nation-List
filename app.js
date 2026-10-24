let currentLevels = [];
let currentTab = "main";
let selectedLevelId = null;
let currentUser = null;
let currentModerator = null;

// Helper: Embed YouTube URLs
function getYouTubeEmbedUrl(url) {
  if (!url) return '';
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : url;
}

// Helper: Escape HTML
function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

// Points formula
function calculatePoints(rank) {
  if (rank > SETTINGS.mainListCutoff) return 0;
  const pts = 350 * Math.pow(55 / 350, (rank - 1) / 24);
  return parseFloat(pts.toFixed(2));
}

// Startup
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("discordLink").href = SETTINGS.discordUrl;
  document.getElementById("ytLink").href = SETTINGS.youtubeUrl;

  setupNavigation();
  setupSearch();
  setupAuth();
  setupForms();

  await checkAuthSession();
  await fetchLevelsFromDB();
});

// Check if user is logged in & if they are a moderator
async function checkAuthSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    
    // Check if moderator
    const { data: mod } = await supabaseClient
      .from('moderators')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (mod) {
      currentModerator = currentUser;
    }

    setLoggedInState();
  } else {
    setLoggedOutState();
  }
}

function setLoggedInState() {
  const playerName = currentUser.user_metadata?.player_name || currentUser.email.split('@')[0];
  
  // Show Profile button
  const profileBtn = document.getElementById("profileTabBtn");
  if (profileBtn) profileBtn.style.display = "inline-block";

  // Show Admin button if moderator
  const adminBtn = document.getElementById("adminTabBtn");
  if (adminBtn) adminBtn.style.display = currentModerator ? "inline-block" : "none";

  // Set Auth button to Logout
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

// Fetch Levels and Victors from Supabase
async function fetchLevelsFromDB() {
  const { data, error } = await supabaseClient
    .from('levels')
    .select(`
      id, rank, name, creator, verifier, video_url, description,
      victors ( id, player_name, percentage, proof_url, device )
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

// Compute player stats globally
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
        const pName = victor.player_name.trim();
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

  const currentName = (currentUser.user_metadata?.player_name || currentUser.email.split('@')[0]).trim();
  document.getElementById("profilePlayerName").textContent = currentName;
  document.getElementById("profileEmail").textContent = currentUser.email;
  document.getElementById("profileAvatar").textContent = currentName.charAt(0).toUpperCase();
  document.getElementById("updatePlayerNameInput").value = currentName;

  const allStats = calculateAllPlayerStats();
  const userStats = allStats.find(p => p.name.toLowerCase() === currentName.toLowerCase());

  if (userStats) {
    document.getElementById("profileRankText").textContent = `#${userStats.rank}`;
    document.getElementById("profileTotalPoints").textContent = `${userStats.points.toFixed(2)} pts`;
    document.getElementById("profileCompletions").textContent = userStats.completions;
    document.getElementById("profileVerifications").textContent = userStats.verifications;

    // Render Beaten Levels
    const beatenContainer = document.getElementById("profileCompletedList");
    if (userStats.beatenLevels.length > 0) {
      beatenContainer.innerHTML = userStats.beatenLevels.sort((a, b) => a.rank - b.rank).map(lvl => `
        <div class="profile-level-row">
          <div>
            <strong>#${lvl.rank} - ${escapeHtml(lvl.name)}</strong>
            <span class="text-muted" style="font-size: 0.8rem; margin-left: 8px;">(${escapeHtml(lvl.device || 'PC')})</span>
          </div>
          <div style="display: flex; gap: 12px; align-items: center;">
            <span style="color: var(--accent); font-weight: 600;">+${lvl.points.toFixed(2)} pts</span>
            ${lvl.proof_url ? `<a href="${escapeHtml(lvl.proof_url)}" target="_blank" rel="noopener noreferrer">Proof</a>` : ''}
          </div>
        </div>
      `).join("");
    } else {
      beatenContainer.innerHTML = `<p class="text-muted">No completed levels recorded yet.</p>`;
    }

    // Render Verified Levels
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
    // Zero records found
    document.getElementById("profileRankText").textContent = "Unranked";
    document.getElementById("profileTotalPoints").textContent = "0.00 pts";
    document.getElementById("profileCompletions").textContent = "0";
    document.getElementById("profileVerifications").textContent = "0";

    document.getElementById("profileCompletedList").innerHTML = `
      <p class="text-muted">No records found matching "<strong>${escapeHtml(currentName)}</strong>". If your records use a different name, update your name below.</p>
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
      lvl.verifier.toLowerCase().includes(query)
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
      ${embedUrl ? `<iframe src="${embedUrl}" allowfullscreen></iframe>` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">No video available</div>`}
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
        ${level.victors && level.victors.length > 0 ? level.victors.map(v => `
          <div class="victor-row">
            <span><strong>${escapeHtml(v.player_name)}</strong> (${escapeHtml(v.device || 'PC')})</span>
            <div>
              <a href="${escapeHtml(v.proof_url)}" target="_blank" rel="noopener noreferrer">Proof</a>
              ${currentModerator ? `<button class="delete-victor-btn" onclick="deleteVictor('${v.id}')">✕ Delete</button>` : ''}
            </div>
          </div>
        `).join("") : `<p style="color: var(--text-muted); padding: 8px 0;">No victors yet.</p>`}
      </div>
    </div>
  `;
}

// Setup Admin & Profile Forms
function setupForms() {
  // Update Display Name Form
  document.getElementById("updateNameForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = document.getElementById("updatePlayerNameInput").value.trim();
    if (!newName) return;

    const { data, error } = await supabaseClient.auth.updateUser({
      data: { player_name: newName }
    });

    if (error) {
      alert("Error updating name: " + error.message);
    } else {
      currentUser = data.user;
      alert(`Name updated to "${newName}"!`);
      setLoggedInState();
    }
  });

  // Add Victor Form
  document.getElementById("addVictorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const levelId = document.getElementById("victorLevelSelect").value;
    const playerName = document.getElementById("victorPlayerName").value.trim();
    const proofUrl = document.getElementById("victorProofUrl").value.trim();
    const device = document.getElementById("victorDevice").value.trim();

    const { error } = await supabaseClient.from('victors').insert([
      { level_id: levelId, player_name: playerName, proof_url: proofUrl, device: device, percentage: 100 }
    ]);

    if (error) {
      alert("Error adding victor: " + error.message);
    } else {
      alert(`Victor record added for ${playerName}!`);
      document.getElementById("addVictorForm").reset();
      await fetchLevelsFromDB();
    }
  });

  // Add Level Form
  document.getElementById("addLevelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const rank = parseInt(document.getElementById("levelRank").value, 10);
    const name = document.getElementById("levelName").value.trim();
    const creator = document.getElementById("levelCreator").value.trim();
    const verifier = document.getElementById("levelVerifier").value.trim();
    const video = document.getElementById("levelVideo").value.trim();
    const description = document.getElementById("levelDescription").value.trim();

    const { error } = await supabaseClient.from('levels').insert([
      { rank, name, creator, verifier, video_url: video, description }
    ]);

    if (error) {
      alert("Error adding level: " + error.message);
    } else {
      alert(`Level ${name} placed at #${rank}!`);
      document.getElementById("addLevelForm").reset();
      await fetchLevelsFromDB();
    }
  });
}

// Delete Victor
window.deleteVictor = async function(victorId) {
  if (!confirm("Are you sure you want to remove this record?")) return;

  const { error } = await supabaseClient.from('victors').delete().eq('id', victorId);
  if (error) {
    alert("Error deleting victor: " + error.message);
  } else {
    await fetchLevelsFromDB();
  }
};

// Populate Level Dropdown for Admin
function populateAdminDropdown() {
  const select = document.getElementById("victorLevelSelect");
  select.innerHTML = currentLevels.map(lvl => `
    <option value="${lvl.id}">#${lvl.rank} - ${escapeHtml(lvl.name)}</option>
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

// Auth Tabs & Handlers (Sign In & Sign Up)
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
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    errorEl.textContent = "Signing in...";

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    modal.classList.remove("active");
    await checkAuthSession();
    renderList();
  });

  // Sign Up submit
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const playerName = document.getElementById("signupPlayerName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    errorEl.textContent = "Creating account...";

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          player_name: playerName
        }
      }
    });

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    if (data.session) {
      modal.classList.remove("active");
      await checkAuthSession();
      renderList();
      alert(`Welcome to ANL, ${playerName}! Your profile is ready.`);
    } else {
      errorEl.style.color = "var(--accent)";
      errorEl.textContent = "Account registered! If confirmation is required, check your email inbox.";
    }
  });
}