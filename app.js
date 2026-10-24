// State management
let currentTab = "main";
let selectedLevelId = null;

// Points formula: Top 1 = 350, Top 25 = 55, Top 50 = minimum points, 51+ = 0 points
function calculatePoints(rank) {
  if (rank > ANL_DATA.settings.mainListCutoff) return 0;
  // Non-linear exponential decay formula matching ANL examples:
  // rank 1 -> ~350, rank 25 -> ~55
  const pts = 350 * Math.pow(55 / 350, (rank - 1) / 24);
  return parseFloat(pts.toFixed(2));
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  // Setup links from settings
  document.getElementById("discordLink").href = ANL_DATA.settings.discordUrl;
  document.getElementById("ytLink").href = ANL_DATA.settings.youtubeUrl;

  setupNavigation();
  setupSearch();
  renderList();
  renderLeaderboard();
});

// Tab Switching
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
      }
    });
  });
}

// Render Level Cards in the Left Sidebar
function renderList() {
  const listContainer = document.getElementById("levelList");
  listContainer.innerHTML = "";

  const isMain = currentTab === "main";
  
  // Filter levels for Main (1-50) or Extended (51+)
  const displayedLevels = ANL_DATA.levels
    .map((lvl, index) => ({ ...lvl, rank: index + 1 }))
    .filter(lvl => isMain ? lvl.rank <= ANL_DATA.settings.mainListCutoff : lvl.rank > ANL_DATA.settings.mainListCutoff);

  if (displayedLevels.length === 0) {
    listContainer.innerHTML = `<div style="padding: 20px; color: var(--text-muted);">No levels in this section yet.</div>`;
    document.getElementById("levelDetails").innerHTML = "";
    return;
  }

  displayedLevels.forEach((level, i) => {
    const item = document.createElement("div");
    item.className = `level-item ${level.id === selectedLevelId || (!selectedLevelId && i === 0) ? "active" : ""}`;
    item.innerHTML = `
      <div class="item-rank">#${level.rank}</div>
      <div class="item-info">
        <div class="item-name">${level.name}</div>
        <div class="item-author">by ${level.creator}</div>
      </div>
    `;

    item.addEventListener("click", () => {
      selectedLevelId = level.id;
      renderList();
      renderLevelDetails(level);
    });

    listContainer.appendChild(item);
  });

  // Default select first item
  const initial = displayedLevels.find(l => l.id === selectedLevelId) || displayedLevels[0];
  if (initial) renderLevelDetails(initial);
}

// Render Right Details Pane
function renderLevelDetails(level) {
  const container = document.getElementById("levelDetails");
  const points = calculatePoints(level.rank);
  const verifierBonus = (points * ANL_DATA.settings.verifierBonusPct).toFixed(2);
  const totalVerifierPts = (points * (1 + ANL_DATA.settings.verifierBonusPct)).toFixed(2);

  container.innerHTML = `
    <div class="level-header">
      <div class="level-title-group">
        <h2>#${level.rank} - ${level.name}</h2>
        <p>Created by <strong>${level.creator}</strong> | Verified by <strong>${level.verifier}</strong></p>
      </div>
      <div class="points-pill">
        ${points > 0 ? `${points.toFixed(2)} pts` : "0.00 pts (Extended)"}
      </div>
    </div>

    <div class="video-wrapper">
      <iframe src="${level.verificationVideo}" allowfullscreen></iframe>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span>Verifier Bonus</span>
        <strong>${points > 0 ? `+${verifierBonus} pts (Total: ${totalVerifierPts})` : '0 pts'}</strong>
      </div>
      <div class="stat-card">
        <span>Total Victors</span>
        <strong>${level.victors.length} Victor(s)</strong>
      </div>
      <div class="stat-card">
        <span>Description</span>
        <strong style="font-size:0.85rem; font-weight: normal;">${level.description || "No description provided."}</strong>
      </div>
    </div>

    <div class="victors-card">
      <h3>Approved 100% Records</h3>
      <div class="victor-list">
        ${level.victors.length > 0 ? level.victors.map(v => `
          <div class="victor-row">
            <span><strong>${v.name}</strong> (${v.device || 'PC'})</span>
            <span>${v.percentage}%</span>
            <a href="${v.proof}" target="_blank">Watch Proof</a>
          </div>
        `).join("") : `<p style="color: var(--text-muted); padding: 8px 0;">No victors yet. Be the first to beat it!</p>`}
      </div>
    </div>
  `;
}

// Search Filter
function setupSearch() {
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".level-item").forEach(item => {
      const match = item.innerText.toLowerCase().includes(q);
      item.style.display = match ? "flex" : "none";
    });
  });
}

// Leaderboard Calculation
function renderLeaderboard() {
  const playerStats = {};

  ANL_DATA.levels.forEach((level, index) => {
    const rank = index + 1;
    const basePts = calculatePoints(rank);

    // Credit Verifier (+20% bonus)
    if (level.verifier) {
      if (!playerStats[level.verifier]) {
        playerStats[level.verifier] = { points: 0, completions: 0, verifications: 0 };
      }
      playerStats[level.verifier].points += basePts * (1 + ANL_DATA.settings.verifierBonusPct);
      playerStats[level.verifier].verifications += 1;
    }

    // Credit Victors (Completions)
    level.victors.forEach(victor => {
      if (!playerStats[victor.name]) {
        playerStats[victor.name] = { points: 0, completions: 0, verifications: 0 };
      }
      playerStats[victor.name].points += basePts;
      playerStats[victor.name].completions += 1;
    });
  });

  // Sort descending by points
  const sortedPlayers = Object.entries(playerStats)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.points - a.points);

  const tbody = document.getElementById("leaderboardBody");
  tbody.innerHTML = sortedPlayers.map((player, index) => `
    <tr>
      <td><strong>#${index + 1}</strong></td>
      <td><strong>${player.name}</strong></td>
      <td style="color: var(--accent); font-weight:700;">${player.points.toFixed(2)}</td>
      <td>${player.completions}</td>
      <td>${player.verifications}</td>
    </tr>
  `).join("");
}