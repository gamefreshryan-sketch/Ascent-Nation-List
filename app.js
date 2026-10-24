let currentLevels = [];
let currentTab = "main";
let selectedLevelId = null;
let currentModerator = null;

// Points formula (Top 1 = 350, Top 25 = 55, Top 50 = min, 51+ = 0)
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

// Check if a moderator is already logged in
async function checkAuthSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const { data: mod } = await supabaseClient
      .from('moderators')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (mod) {
      setModeratorState(session.user);
    }
  }
}

function setModeratorState(user) {
  currentModerator = user;
  document.getElementById("adminTabBtn").style.display = "block";
  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = "Logout";
  authBtn.onclick = async () => {
    await supabaseClient.auth.signOut();
    location.reload();
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
    return;
  }

  currentLevels = data;
  renderList();
  renderLeaderboard();
  populateAdminDropdown();
}

// Render Level List
function renderList() {
  const listContainer = document.getElementById("levelList");
  listContainer.innerHTML = "";

  const isMain = currentTab === "main";
  const filtered = currentLevels.filter(lvl => 
    isMain ? lvl.rank <= SETTINGS.mainListCutoff : lvl.rank > SETTINGS.mainListCutoff
  );

  if (filtered.length === 0) {
    listContainer.innerHTML = `<div style="padding: 20px; color: var(--text-muted);">No levels in this section.</div>`;
    document.getElementById("levelDetails").innerHTML = "";
    return;
  }

  filtered.forEach((level, i) => {
    const item = document.createElement("div");
    item.className = `level-item ${level.id === selectedLevelId || (!selectedLevelId && i === 0) ? "active" : ""}`;
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
      renderLevelDetails(level);
    });

    listContainer.appendChild(item);
  });

  const selected = filtered.find(l => l.id === selectedLevelId) || filtered[0];
  if (selected) {
    selectedLevelId = selected.id;
    renderLevelDetails(selected);
  }
}

// Render Level Details
function renderLevelDetails(level) {
  const container = document.getElementById("levelDetails");
  const points = calculatePoints(level.rank);
  const verifierBonus = (points * SETTINGS.verifierBonusPct).toFixed(2);
  const totalVerifierPts = (points * (1 + SETTINGS.verifierBonusPct)).toFixed(2);

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
      <iframe src="${level.video_url || ''}" allowfullscreen></iframe>
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
              <a href="${v.proof_url}" target="_blank">Proof</a>
              ${currentModerator ? `<button class="delete-victor-btn" onclick="deleteVictor(${v.id})">✕ Delete</button>` : ''}
            </div>
          </div>
        `).join("") : `<p style="color: var(--text-muted); padding: 8px 0;">No victors yet.</p>`}
      </div>
    </div>
  `;
}

// Calculate Leaderboard
function renderLeaderboard() {
  const playerStats = {};

  currentLevels.forEach(level => {
    const basePts = calculatePoints(level.rank);

    // Credit Verifier
    if (level.verifier) {
      if (!playerStats[level.verifier]) {
        playerStats[level.verifier] = { points: 0, completions: 0, verifications: 0 };
      }
      playerStats[level.verifier].points += basePts * (1 + SETTINGS.verifierBonusPct);
      playerStats[level.verifier].verifications += 1;
    }

    // Credit Victors
    if (level.victors) {
      level.victors.forEach(victor => {
        if (!playerStats[victor.player_name]) {
          playerStats[victor.player_name] = { points: 0, completions: 0, verifications: 0 };
        }
        playerStats[victor.player_name].points += basePts;
        playerStats[victor.player_name].completions += 1;
      });
    }
  });

  const sorted = Object.entries(playerStats)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.points - a.points);

  const tbody = document.getElementById("leaderboardBody");
  tbody.innerHTML = sorted.map((p, idx) => `
    <tr>
      <td><strong>#${idx + 1}</strong></td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td style="color: var(--accent); font-weight:700;">${p.points.toFixed(2)}</td>
      <td>${p.completions}</td>
      <td>${p.verifications}</td>
    </tr>
  `).join("");
}

// Setup Admin Forms (Adding levels & victors)
function setupForms() {
  // Add Victor Form
  document.getElementById("addVictorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const levelId = document.getElementById("victorLevelSelect").value;
    const playerName = document.getElementById("victorPlayerName").value.trim();
    const proofUrl = document.getElementById("victorProofUrl").value.trim();
    const device = document.getElementById("victorDevice").value.trim();

    const { error } = await supabaseClient.from('victors').insert([
      { level_id: levelId, player_name: playerName, proof_url: proofUrl, device: device }
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
    const rank = parseInt(document.getElementById("levelRank").value);
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

// Delete a Victor (Moderators only)
async function deleteVictor(victorId) {
  if (!confirm("Are you sure you want to remove this record?")) return;

  const { error } = await supabaseClient.from('victors').delete().eq('id', victorId);
  if (error) {
    alert("Error deleting victor: " + error.message);
  } else {
    await fetchLevelsFromDB();
  }
}

// Populate Level Dropdown for the Admin form
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
      } else if (tab === "rules") {
        document.getElementById("rulesView").classList.add("active");
      } else if (tab === "admin") {
        document.getElementById("adminView").classList.add("active");
      }
    });
  });
}

// Search Filter
function setupSearch() {
  const input = document.getElementById("searchInput");
  input.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".level-item").forEach(item => {
      item.style.display = item.innerText.toLowerCase().includes(q) ? "flex" : "none";
    });
  });
}

// Auth Modal / Login Handler
function setupAuth() {
  const modal = document.getElementById("authModal");
  const authBtn = document.getElementById("authBtn");
  const closeBtn = document.getElementById("closeAuthModal");

  authBtn.onclick = () => {
    if (!currentModerator) modal.classList.add("active");
  };

  closeBtn.onclick = () => modal.classList.remove("active");

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;
    const errorEl = document.getElementById("loginError");

    errorEl.textContent = "Signing in...";

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    // Verify moderator privileges
    const { data: mod } = await supabaseClient
      .from('moderators')
      .select('*')
      .eq('user_id', data.user.id)
      .single();

    if (!mod) {
      errorEl.textContent = "Account verified, but you lack moderator permissions.";
      await supabaseClient.auth.signOut();
      return;
    }

    modal.classList.remove("active");
    setModeratorState(data.user);
    renderList(); // Re-render to show delete buttons
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}