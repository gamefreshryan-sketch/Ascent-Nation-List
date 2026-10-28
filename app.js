let currentLevels = [];
let currentTab = "main";
let selectedLevelId = null;
let currentUser = null;
let currentProfile = null;
let isModerator = false;
let activeProfilePlayer = null;
let currentProfileSort = "rank";
let targetBanProfile = null;
let pendingSubmissionsCache = [];
let currentRejectSubmissionId = null;

// Helpers
function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@anl-player.com`;
}

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

function getYouTubeEmbedUrl(url) {
  if (!url) return '';
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : '';
}

function getYouTubeThumbnailUrl(url) {
  if (!url) return '';
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg` : '';
}

function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

function formatDate(dStr) {
  if (!dStr) return '';
  const d = new Date(dStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function calculatePoints(rank) {
  if (!rank || rank > SETTINGS.mainListCutoff || rank < 1) return 0;
  const pts = 350 * Math.pow(55 / 350, (rank - 1) / 24);
  return parseFloat(pts.toFixed(2));
}

function calculatePointsForRecord(rank, percentage, minReq = 100) {
  const basePts = calculatePoints(rank);
  if (basePts === 0) return 0;

  const pct = Math.min(100, Math.max(0, parseInt(percentage, 10) || 100));
  const minPercent = Math.min(100, Math.max(1, parseInt(minReq, 10) || 100));

  if (pct === 100) return basePts;

  if (pct >= minPercent && minPercent < 100) {
    const progressRatio = (pct - minPercent) / (100 - minPercent);
    const multiplier = 0.10 + (0.40 * progressRatio);
    return parseFloat((basePts * multiplier).toFixed(2));
  }
  return 0;
}

// App Startup
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("discordLink").href = safeUrl(SETTINGS.discordUrl) || '#';
  document.getElementById("ytLink").href = safeUrl(SETTINGS.youtubeUrl) || '#';

  setupNavigation();
  setupSearch();
  setupAuth();
  setupForms();
  setupModModals();
  setupDelegatedEvents();

  await checkAuthSession();
  await fetchLevelsFromDB();
  await refreshQueueState();
});

// Click delegation
function setupDelegatedEvents() {
  document.addEventListener("click", async (e) => {
    // 1. Player link (works for any visitor logged in or logged out)
    const playerLink = e.target.closest(".player-link");
    if (playerLink && playerLink.dataset.player) {
      e.preventDefault();
      openPlayerProfile(playerLink.dataset.player);
      return;
    }

    // 2. Return to own profile
    if (e.target.id === "viewMyProfileBtn") {
      activeProfilePlayer = null;
      renderProfile();
      return;
    }

    // 3. Profile records sort
    const sortBtn = e.target.closest(".sort-btn");
    if (sortBtn && sortBtn.dataset.sort) {
      document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
      sortBtn.classList.add("active");
      currentProfileSort = sortBtn.dataset.sort;
      renderProfile();
      return;
    }

    // 4. Delete victor button
    const delBtn = e.target.closest(".delete-victor-btn");
    if (delBtn && delBtn.dataset.victorId) {
      await deleteVictor(delBtn.dataset.victorId);
      return;
    }

    // 5. Queue Direct Approve
    const approveBtn = e.target.closest(".approve-sub-btn");
    if (approveBtn && approveBtn.dataset.subId) {
      await approveSubmission(approveBtn.dataset.subId);
      return;
    }

    // 6. Queue Manual Accept (Edit before placing)
    const manualBtn = e.target.closest(".manual-accept-sub-btn");
    if (manualBtn && manualBtn.dataset.subId) {
      openManualAcceptModal(manualBtn.dataset.subId);
      return;
    }

    // 7. Queue Deny
    const denyBtn = e.target.closest(".deny-sub-btn");
    if (denyBtn && denyBtn.dataset.subId) {
      currentRejectSubmissionId = denyBtn.dataset.subId;
      document.getElementById("rejectCustomReason").value = "";
      document.getElementById("rejectPreset").value = "";
      document.getElementById("rejectModal").classList.add("active");
      return;
    }
  });
}

function openPlayerProfile(playerName) {
  activeProfilePlayer = playerName.trim();

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  // Only highlight the profile tab button if the user is currently logged in
  const profileBtn = document.getElementById("profileTabBtn");
  if (profileBtn && currentUser) {
    profileBtn.classList.add("active");
  }

  const profileView = document.getElementById("profileView");
  if (profileView) profileView.classList.add("active");

  currentTab = "profile";
  renderProfile();
}

async function checkAuthSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;

    const { data: prof } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (prof) {
      currentProfile = prof;
      isModerator = prof.is_mod === true;

      if (prof.is_banned) {
        const reason = prof.ban_reason || "Violation of Ascent Nation List rules.";
        await supabaseClient.auth.signOut();
        currentUser = null;
        currentProfile = null;
        isModerator = false;
        alert(`⛔ YOUR ACCOUNT HAS BEEN BANNED:\n\nReason: "${reason}"\n\nIf you believe this is a false ban, appeal via our Discord.`);
        setLoggedOutState();
        return;
      }
    } else {
      currentProfile = null;
      isModerator = false;
    }

    setLoggedInState();
  } else {
    setLoggedOutState();
  }
}

function setLoggedInState() {
  const playerName = currentProfile?.username 
                  || currentUser.user_metadata?.player_name 
                  || currentUser.email?.split('@')[0] 
                  || "Player";

  document.querySelectorAll(".mod-only").forEach(el => {
    el.style.display = isModerator ? "inline-block" : "none";
  });

  // Show profile navigation button in the navbar when authenticated
  const profileTabBtn = document.getElementById("profileTabBtn");
  if (profileTabBtn) {
    profileTabBtn.style.display = "inline-flex";
  }

  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = `Logout (${playerName})`;
  authBtn.onclick = async () => {
    await supabaseClient.auth.signOut();
    location.reload();
  };

  renderProfile();
  checkSubmissionRestrictions();
}

function setLoggedOutState() {
  currentUser = null;
  currentProfile = null;
  isModerator = false;

  document.querySelectorAll(".mod-only").forEach(el => {
    el.style.display = "none";
  });

  // Hide the profile navigation button from the menu bar when logged out
  const profileTabBtn = document.getElementById("profileTabBtn");
  if (profileTabBtn) {
    profileTabBtn.style.display = "none";
    profileTabBtn.classList.remove("active");
  }

  const authBtn = document.getElementById("authBtn");
  authBtn.textContent = "Sign In / Register";
  authBtn.onclick = () => {
    document.getElementById("authModal").classList.add("active");
  };

  // If currently looking at own profile, return to main list
  if (currentTab === "profile" && !activeProfilePlayer) {
    currentTab = "main";
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById("listView")?.classList.add("active");
    document.querySelector('.nav-btn[data-tab="main"]')?.classList.add("active");
  } else {
    renderProfile();
  }

  checkSubmissionRestrictions();
}

function checkSubmissionRestrictions() {
  const noticeBox = document.getElementById("submitNoticeBox");
  const submitBtn = document.getElementById("submitRecordBtn");

  if (!currentUser) {
    noticeBox.style.display = "block";
    noticeBox.style.background = "rgba(239, 68, 68, 0.15)";
    noticeBox.style.border = "1px solid var(--danger)";
    noticeBox.style.color = "var(--danger)";
    noticeBox.innerHTML = `⚠️ You must be logged in to submit records. Please <a href="#" onclick="document.getElementById('authModal').classList.add('active');return false;" style="color:var(--accent);font-weight:bold;">Sign In</a>.`;
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  if (currentProfile && currentProfile.submission_banned_until) {
    const bannedUntil = new Date(currentProfile.submission_banned_until);
    if (bannedUntil > new Date()) {
      noticeBox.style.display = "block";
      noticeBox.style.background = "rgba(245, 158, 11, 0.15)";
      noticeBox.style.border = "1px solid var(--accent-gold)";
      noticeBox.style.color = "var(--accent-gold)";
      noticeBox.innerHTML = `⏳ <strong>Submission Timeout Active:</strong> You are barred from sending submits until <strong>${formatDate(currentProfile.submission_banned_until)}</strong>.`;
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
  }

  const myPending = pendingSubmissionsCache.filter(s => s.user_id === currentUser.id && s.status === 'pending');
  if (myPending.length >= 3) {
    noticeBox.style.display = "block";
    noticeBox.style.background = "rgba(245, 158, 11, 0.15)";
    noticeBox.style.border = "1px solid var(--accent-gold)";
    noticeBox.style.color = "var(--accent-gold)";
    noticeBox.innerHTML = `⚠️ <strong>Submission limit reached:</strong> You have 3 submissions currently on hold. Please wait for them to be reviewed.`;
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  noticeBox.style.display = "none";
  if (submitBtn) submitBtn.disabled = false;
}

async function fetchLevelsFromDB() {
  const { data, error } = await supabaseClient
    .from('levels')
    .select(`
      *,
      victors ( id, player_name, percentage, proof_url, device, user_id )
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
  populateDropdowns();
}

async function refreshQueueState() {
  const { data, error } = await supabaseClient
    .from('submissions')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error("Error fetching submissions queue:", error);
    return;
  }

  pendingSubmissionsCache = data || [];

  const pendingCount = pendingSubmissionsCache.filter(s => s.status === 'pending').length;
  const badge = document.getElementById("queueBadge");
  const badgeMenu = document.getElementById("queueBadgeMenu");
  if (badge) badge.textContent = pendingCount;
  if (badgeMenu) badgeMenu.textContent = pendingCount;

  if (isModerator && currentTab === "queue") {
    renderQueue();
  }

  if (currentTab === "profile") {
    renderProfileSubmissions();
  }

  checkSubmissionRestrictions();
}

function populateDropdowns() {
  const optionsHtml = currentLevels.map(lvl => `
    <option value="${escapeHtml(lvl.id)}">#${lvl.rank} - ${escapeHtml(lvl.name)}</option>
  `).join("");

  const subSelect = document.getElementById("subLevelSelect");
  if (subSelect) subSelect.innerHTML = optionsHtml;

  const adminSelect = document.getElementById("victorLevelSelect");
  if (adminSelect) adminSelect.innerHTML = optionsHtml;
}

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

    // Credit Victors
    if (level.victors) {
      level.victors.forEach(victor => {
        const pName = (victor.player_name || '').trim();
        if (!pName) return;

        const pct = parseInt(victor.percentage, 10) || 100;
        if (pct < minReq) return;

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

async function renderProfile() {
  const allStats = calculateAllPlayerStats();

  let targetPlayerName = activeProfilePlayer;
  const loggedInName = currentProfile?.username 
                    || currentUser?.user_metadata?.player_name 
                    || currentUser?.email?.split('@')[0] 
                    || "";

  const isViewingSelf = !!currentUser && (
    !activeProfilePlayer || (loggedInName && loggedInName.toLowerCase() === activeProfilePlayer.toLowerCase())
  );

  if (!targetPlayerName) {
    if (currentUser) {
      targetPlayerName = loggedInName;
    } else {
      targetPlayerName = allStats.length > 0 ? allStats[0].name : "Player";
    }
  }

  const toolbar = document.getElementById("profileToolbar");
  toolbar.style.display = (currentUser && !isViewingSelf) ? "block" : "none";

  targetBanProfile = null;
  const { data: targetProfileData } = await supabaseClient
    .from('profiles')
    .select('*')
    .ilike('username', targetPlayerName)
    .maybeSingle();

  if (targetProfileData) targetBanProfile = targetProfileData;

  const modActionsCard = document.getElementById("profileModActionsCard");
  const banBadge = document.getElementById("profileBanBadge");
  const unbanBtn = document.getElementById("unbanPlayerBtn");

  if (isModerator && !isViewingSelf && targetBanProfile) {
    modActionsCard.style.display = "block";
    document.getElementById("modTargetPlayerName").textContent = targetBanProfile.username;
    if (targetBanProfile.is_banned) {
      banBadge.style.display = "inline-block";
      unbanBtn.style.display = "inline-block";
    } else {
      banBadge.style.display = "none";
      unbanBtn.style.display = "none";
    }
  } else {
    modActionsCard.style.display = "none";
    banBadge.style.display = targetBanProfile?.is_banned ? "inline-block" : "none";
  }

  const bioEditCard = document.getElementById("bioEditCard");
  if (isViewingSelf) {
    bioEditCard.style.display = "block";
    document.getElementById("updateBioInput").value = currentProfile?.bio || "";
  } else {
    bioEditCard.style.display = "none";
  }

  const bioDisplay = document.getElementById("profileBioDisplay");
  if (isViewingSelf && currentProfile) {
    bioDisplay.textContent = currentProfile.bio || "No personal bio written yet.";
  } else if (targetBanProfile) {
    bioDisplay.textContent = targetBanProfile.bio || `Showing Ascent Nation public profile for ${targetPlayerName}.`;
  } else {
    bioDisplay.textContent = `Showing Ascent Nation public profile for ${targetPlayerName}.`;
  }

  document.getElementById("profilePlayerName").textContent = targetPlayerName;
  document.getElementById("profileAvatar").textContent = (targetPlayerName.charAt(0) || "?").toUpperCase();
  document.getElementById("profileBadge").textContent = isViewingSelf 
    ? (isModerator ? "Moderator (Me)" : "My Account") 
    : (targetBanProfile?.is_mod ? "Moderator" : "Player");

  const userStats = allStats.find(p => p.name.toLowerCase() === targetPlayerName.toLowerCase());

  if (userStats) {
    document.getElementById("profileRankText").textContent = `#${userStats.rank}`;
    document.getElementById("profileTotalPoints").textContent = `${userStats.points.toFixed(2)} pts`;
    document.getElementById("profileCompletions").textContent = userStats.completions;
    document.getElementById("profileProgressions").textContent = userStats.progressions;
    document.getElementById("profileVerifications").textContent = userStats.verifications;

    const records = [...userStats.beatenLevels];
    if (currentProfileSort === "rank") records.sort((a, b) => a.rank - b.rank);
    else if (currentProfileSort === "points") records.sort((a, b) => b.points - a.points);
    else if (currentProfileSort === "pct") records.sort((a, b) => b.percentage - a.percentage);
    else if (currentProfileSort === "name") records.sort((a, b) => a.name.localeCompare(b.name));

    const beatenContainer = document.getElementById("profileCompletedList");
    if (records.length > 0) {
      beatenContainer.innerHTML = records.map(lvl => {
        const validatedUrl = safeUrl(lvl.proof_url);
        return `
          <div class="profile-level-row">
            <div>
              <strong>#${lvl.rank} - ${escapeHtml(lvl.name)}</strong>
              <span class="pct-badge ${lvl.isCompletion ? 'pct-100' : 'pct-partial'}">${lvl.percentage}%</span>
              <span class="text-muted" style="font-size: 0.8rem; margin-left: 6px;">(${escapeHtml(lvl.device || 'PC')})</span>
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
              <span style="color: var(--accent); font-weight: 600;">+${lvl.points.toFixed(2)} pts</span>
              ${validatedUrl ? `<a href="${validatedUrl}" target="_blank" rel="noopener noreferrer">Proof</a>` : ''}
            </div>
          </div>
        `;
      }).join("");
    } else {
      beatenContainer.innerHTML = `<p class="text-muted">No completed or qualifying progress records found.</p>`;
    }

    const verifiedContainer = document.getElementById("profileVerifiedList");
    if (userStats.verifiedLevels.length > 0) {
      verifiedContainer.innerHTML = userStats.verifiedLevels.sort((a, b) => a.rank - b.rank).map(lvl => `
        <div class="profile-level-row">
          <div>
            <strong>#${lvl.rank} - ${escapeHtml(lvl.name)}</strong>
            <span class="text-muted" style="font-size: 0.8rem; margin-left: 6px;">by ${escapeHtml(lvl.creator)}</span>
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
    document.getElementById("profileCompletedList").innerHTML = `<p class="text-muted">No list records found for "${escapeHtml(targetPlayerName)}".</p>`;
    document.getElementById("profileVerifiedList").innerHTML = `<p class="text-muted">No verified levels.</p>`;
  }

  renderProfileSubmissions(isViewingSelf);
}

function renderProfileSubmissions(isViewingSelf) {
  const container = document.getElementById("myPrivateSubmissionsCard");
  const list = document.getElementById("profileSubmissionsList");
  const countBadge = document.getElementById("mySubmissionsCountBadge");

  if (!currentUser || !isViewingSelf) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  const mySubmissions = pendingSubmissionsCache.filter(s => s.user_id === currentUser.id);

  // Update submissions badge count on the dropdown header
  if (countBadge) {
    if (mySubmissions.length > 0) {
      countBadge.textContent = mySubmissions.length;
      countBadge.style.display = "inline-block";
    } else {
      countBadge.style.display = "none";
    }
  }

  if (mySubmissions.length === 0) {
    list.innerHTML = `<p class="text-muted">You have no active submissions.</p>`;
    return;
  }

  const globalPending = pendingSubmissionsCache.filter(s => s.status === 'pending');

  list.innerHTML = mySubmissions.map(sub => {
    let levelTitle = "";
    if (sub.type === "verification") {
      levelTitle = `[Verification] ${sub.level_name || 'New Level'} (by ${sub.creator || 'Unknown'})`;
    } else {
      const level = currentLevels.find(l => l.id == sub.level_id);
      levelTitle = level ? `#${level.rank} - ${level.name}` : `Level ID: ${sub.level_id}`;
    }
    
    let statusBadge = "";
    let queuePosText = "";

    if (sub.status === 'pending') {
      const qIndex = globalPending.findIndex(p => p.id === sub.id);
      const pos = qIndex >= 0 ? qIndex + 1 : 1;
      statusBadge = `<span class="status-badge badge-pending">ON HOLD</span>`;
      queuePosText = `<span class="queue-pos-indicator">Queue Position: #${pos} of ${globalPending.length}</span>`;
    } else if (sub.status === 'accepted') {
      statusBadge = `<span class="status-badge badge-accepted">ACCEPTED</span>`;
      queuePosText = `<span class="text-muted" style="font-size:0.8rem;">Reviewed by ${escapeHtml(sub.reviewed_by || 'Moderator')}</span>`;
    } else if (sub.status === 'rejected') {
      statusBadge = `<span class="status-badge badge-rejected">REJECTED</span>`;
      queuePosText = `<span class="text-muted" style="font-size:0.8rem; color:var(--danger);">Reason: ${escapeHtml(sub.rejection_reason || 'Guidelines not met')}</span>`;
    }

    return `
      <div class="profile-level-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
        <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; flex-wrap: wrap;">
          <div>
            <strong>${escapeHtml(levelTitle)}</strong>
            <span class="pct-badge ${sub.percentage === 100 ? 'pct-100' : 'pct-partial'}">${sub.percentage}%</span>
            <span style="text-transform: capitalize; font-size: 0.8rem; margin-left: 6px; color: var(--accent); font-weight:600;">(${sub.type})</span>
          </div>
          <div>${statusBadge}</div>
        </div>
        <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>${queuePosText}</div>
          <div><a href="${safeUrl(sub.proof_url)}" target="_blank" rel="noopener noreferrer">View Proof</a></div>
        </div>
      </div>
    `;
  }).join("");
}

// Render Moderator Review Queue
function renderQueue() {
  const container = document.getElementById("queueItemsList");
  if (!isModerator) {
    container.innerHTML = `<p class="text-muted">Unauthorized.</p>`;
    return;
  }

  const typeFilter = document.getElementById("queueTypeFilter")?.value || "all";
  const orderFilter = document.getElementById("queueOrderFilter")?.value || "asc";

  let pending = pendingSubmissionsCache.filter(s => s.status === 'pending');

  if (typeFilter !== "all") {
    pending = pending.filter(s => s.type === typeFilter);
  }

  pending.sort((a, b) => {
    const da = new Date(a.created_at).getTime();
    const db = new Date(b.created_at).getTime();
    return orderFilter === "asc" ? da - db : db - da;
  });

  if (pending.length === 0) {
    container.innerHTML = `<div class="loading">No pending submissions in queue. Clean inbox! 🎉</div>`;
    return;
  }

  container.innerHTML = pending.map((sub, index) => {
    let levelTitle = "";
    let isNewVerification = sub.type === "verification";

    if (isNewVerification) {
      levelTitle = `⭐ [New Level] ${sub.level_name || 'Untitled'} (by ${sub.creator || 'Unknown'})`;
    } else {
      const level = currentLevels.find(l => l.id == sub.level_id);
      levelTitle = level ? `#${level.rank} - ${level.name} (Min Req: ${level.min_percentage || 100}%)` : `Level ID: ${sub.level_id}`;
    }

    const proofLink = safeUrl(sub.proof_url);
    const rawLink = safeUrl(sub.raw_footage_url);

    return `
      <div class="queue-card">
        <div class="queue-card-header">
          <div>
            <span class="queue-pos-indicator">#${index + 1} in Queue</span>
            <strong style="margin-left: 8px; font-size: 1rem;">${escapeHtml(levelTitle)}</strong>
            <span class="pct-badge ${sub.percentage === 100 ? 'pct-100' : 'pct-partial'}">${sub.percentage}%</span>
          </div>
          <span class="text-muted" style="font-size: 0.8rem;">Submitted: ${formatDate(sub.created_at)}</span>
        </div>

        <div class="queue-grid">
          <div>
            <span class="text-muted">Player:</span>
            <strong><a href="#" class="player-link" data-player="${escapeHtml(sub.player_name)}">${escapeHtml(sub.player_name)}</a></strong>
          </div>
          <div>
            <span class="text-muted">Type:</span>
            <strong style="text-transform: capitalize; color: var(--accent);">${escapeHtml(sub.type)}</strong>
          </div>
          <div>
            <span class="text-muted">Device:</span>
            <strong>${escapeHtml(sub.device || 'PC')}</strong>
          </div>
          <div>
            <span class="text-muted">Proof Footage:</span>
            ${proofLink ? `<a href="${proofLink}" target="_blank" rel="noopener noreferrer">Watch Video ↗</a>` : 'None'}
          </div>
          ${rawLink ? `
            <div>
              <span class="text-muted">Raw Stream / Drive:</span>
              <a href="${rawLink}" target="_blank" rel="noopener noreferrer">Inspect Raw ↗</a>
            </div>
          ` : ''}
          ${isNewVerification ? `
            <div>
              <span class="text-muted">Length:</span>
              <strong>${escapeHtml(sub.level_length || 'N/A')}</strong>
            </div>
            <div>
              <span class="text-muted">Req %:</span>
              <strong>${sub.min_percentage || 100}%</strong>
            </div>
          ` : ''}
        </div>

        ${sub.level_description ? `
          <div style="background: var(--bg-secondary); padding: 6px 10px; border-radius: 6px; font-size: 0.8rem;">
            <span class="text-muted">Level Info:</span> "${escapeHtml(sub.level_description)}"
          </div>
        ` : ''}

        ${sub.notes ? `
          <div style="background: var(--bg-secondary); padding: 6px 10px; border-radius: 6px; font-size: 0.8rem;">
            <span class="text-muted">Submitter Notes:</span> "${escapeHtml(sub.notes)}"
          </div>
        ` : ''}

        <div class="queue-actions">
          <button type="button" class="btn-deny deny-sub-btn" data-sub-id="${sub.id}">✕ Deny with Reason</button>
          <button type="button" class="btn-manual manual-accept-sub-btn" data-sub-id="${sub.id}">✍️ Manual Accept</button>
          ${!isNewVerification ? `
            <button type="button" class="btn-approve approve-sub-btn" data-sub-id="${sub.id}">✓ Quick Accept</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");
}

// 1. Direct Quick Accept (Completions)
async function approveSubmission(subId) {
  if (!isModerator) return;
  const sub = pendingSubmissionsCache.find(s => s.id == subId);
  if (!sub) return;

  const level = currentLevels.find(l => l.id == sub.level_id);
  const levelTitle = level ? `#${level.rank} - ${level.name}` : `Level #${sub.level_id}`;

  if (!confirm(`Quick-approve record for ${sub.player_name} on ${levelTitle}?`)) return;

  const modName = currentProfile?.username || "Moderator";

  const { error: vicErr } = await supabaseClient
    .from('victors')
    .insert([{
      level_id: sub.level_id,
      player_name: sub.player_name,
      user_id: sub.user_id,
      percentage: sub.percentage,
      proof_url: sub.proof_url,
      device: sub.device
    }]);

  if (vicErr) {
    alert("Error placing victor record: " + vicErr.message);
    return;
  }

  await supabaseClient
    .from('submissions')
    .update({
      status: 'accepted',
      reviewed_by: modName,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', sub.id);

  await logModeratorAction(
    "APPROVE_SUBMISSION",
    sub.player_name,
    `Accepted completion (${sub.percentage}%) on ${levelTitle}`
  );

  alert(`Submission accepted for ${sub.player_name}!`);
  await fetchLevelsFromDB();
  await refreshQueueState();
}

// 2. Open Manual Accept Modal
function openManualAcceptModal(subId) {
  const sub = pendingSubmissionsCache.find(s => s.id == subId);
  if (!sub) return;

  document.getElementById("manSubId").value = sub.id;
  document.getElementById("manVerifier").value = sub.player_name;
  document.getElementById("manVideo").value = sub.proof_url;
  document.getElementById("manDevice").value = sub.device || "PC";

  if (sub.type === "verification") {
    document.getElementById("manName").value = sub.level_name || "";
    document.getElementById("manCreator").value = sub.creator || "";
    document.getElementById("manLength").value = sub.level_length || "1:00";
    document.getElementById("manMinPct").value = sub.min_percentage || 100;
    document.getElementById("manDesc").value = sub.level_description || "";
    document.getElementById("manRank").value = "1";
  } else {
    const level = currentLevels.find(l => l.id == sub.level_id);
    document.getElementById("manName").value = level ? level.name : "";
    document.getElementById("manCreator").value = level ? level.creator : "";
    document.getElementById("manLength").value = level ? level.length : "1:00";
    document.getElementById("manMinPct").value = level ? level.min_percentage : 100;
    document.getElementById("manDesc").value = level ? level.description : "";
    document.getElementById("manRank").value = level ? level.rank : 1;
  }

  document.getElementById("manualAcceptModal").classList.add("active");
}

// Deny submission
async function denySubmission(subId, reason) {
  if (!isModerator) return;
  const sub = pendingSubmissionsCache.find(s => s.id == subId);
  if (!sub) return;

  const modName = currentProfile?.username || "Moderator";
  const levelTitle = sub.level_name || (currentLevels.find(l => l.id == sub.level_id)?.name || `Level #${sub.level_id}`);

  const { error } = await supabaseClient
    .from('submissions')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      reviewed_by: modName,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', subId);

  if (error) {
    alert("Error rejecting submission: " + error.message);
    return;
  }

  await logModeratorAction(
    "DENY_SUBMISSION",
    sub.player_name,
    `Denied ${sub.type} on ${levelTitle}. Reason: "${reason}"`
  );

  document.getElementById("rejectModal").classList.remove("active");
  await refreshQueueState();
}

async function logModeratorAction(action, targetName, details) {
  try {
    const modUsername = currentProfile?.username || "Moderator";
    await supabaseClient.from('mod_logs').insert([{
      mod_id: currentUser?.id,
      mod_username: modUsername,
      action: action,
      target_name: targetName,
      details: details
    }]);
  } catch (err) {
    console.error("Failed to write mod log:", err);
  }
}

async function fetchAndRenderModLogs() {
  const tbody = document.getElementById("logsTableBody");
  tbody.innerHTML = `<tr><td colspan="5" class="loading">Loading logs...</td></tr>`;

  const { data, error } = await supabaseClient
    .from('mod_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger);padding:14px;">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:14px;color:var(--text-muted);">No logs recorded.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(log => `
    <tr>
      <td style="font-size:0.8rem; color:var(--text-muted);">${formatDate(log.created_at)}</td>
      <td><strong>${escapeHtml(log.mod_username)}</strong></td>
      <td><span class="pct-badge pct-partial" style="margin-left:0;">${escapeHtml(log.action)}</span></td>
      <td><strong>${escapeHtml(log.target_name || 'N/A')}</strong></td>
      <td style="font-size:0.85rem;">${escapeHtml(log.details)}</td>
    </tr>
  `).join("");
}

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

    const thumbUrl = getYouTubeThumbnailUrl(level.video_url);
    const maxPts = calculatePoints(level.rank);
    const minReq = level.min_percentage ? parseInt(level.min_percentage, 10) : 100;

    let pointsText = "";
    if (maxPts > 0) {
      if (minReq < 100) {
        const minPts = calculatePointsForRecord(level.rank, minReq, minReq);
        pointsText = `${minPts.toFixed(1)} &mdash; ${maxPts.toFixed(1)} pts`;
      } else {
        pointsText = `${maxPts.toFixed(2)} pts`;
      }
    } else {
      pointsText = "0.00 pts (Extended)";
    }

    item.innerHTML = `
      ${thumbUrl ? `<div class="item-bg-thumb" style="background-image: url('${thumbUrl}')"></div>` : ''}
      <div class="item-overlay"></div>
      <div class="item-content">
        <div class="item-title-row">
          <span class="item-rank">#${level.rank}</span>
          <span class="item-name">${escapeHtml(level.name)}</span>
        </div>
        <div class="item-meta-row">
          <span class="item-author">by ${escapeHtml(level.creator)}</span>
          <span class="item-sep">|</span>
          <span class="item-verifier">${escapeHtml(level.verifier || 'Unknown')}</span>
        </div>
        <div class="item-points-row">
          <span class="item-points-label">${pointsText}</span>
        </div>
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

    <div class="stat-card" style="margin-bottom: 20px;">
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
                <span class="text-muted" style="font-size:0.8rem; margin-left:6px;">(${escapeHtml(v.device || 'PC')})</span>
              </div>
              <div>
                ${validProof ? `<a href="${validProof}" target="_blank" rel="noopener noreferrer">Proof</a>` : ''}
                ${isModerator ? `<button type="button" class="delete-victor-btn" data-victor-id="${escapeHtml(v.id)}">✕</button>` : ''}
              </div>
            </div>
          `;
        }).join("") : `<p style="color: var(--text-muted); padding: 8px 0;">No approved records yet.</p>`}
      </div>
    </div>
  `;
}

function setupForms() {
  const subTypeSelect = document.getElementById("subType");
  const compGroup = document.getElementById("fieldGroupCompletion");
  const veriGroup = document.getElementById("fieldGroupVerification");

  if (subTypeSelect) {
    subTypeSelect.addEventListener("change", () => {
      const isVeri = subTypeSelect.value === "verification";
      compGroup.style.display = isVeri ? "none" : "block";
      veriGroup.style.display = isVeri ? "block" : "none";

      document.getElementById("subNewLevelName").required = isVeri;
      document.getElementById("subNewLevelCreator").required = isVeri;
      document.getElementById("subNewLevelLength").required = isVeri;
    });
  }

  // 1. Submit Record to Queue Form
  const recordSubForm = document.getElementById("recordSubmissionForm");
  if (recordSubForm) {
    recordSubForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) {
        alert("Please sign in or register to submit a record.");
        return;
      }

      const myPending = pendingSubmissionsCache.filter(s => s.user_id === currentUser.id && s.status === 'pending');
      if (myPending.length >= 3) {
        alert("Submission limit reached: You already have 3 pending submissions on hold.");
        return;
      }

      if (currentProfile && currentProfile.submission_banned_until) {
        const bannedUntil = new Date(currentProfile.submission_banned_until);
        if (bannedUntil > new Date()) {
          alert(`You are currently timed out from submissions until: ${formatDate(currentProfile.submission_banned_until)}`);
          return;
        }
      }

      const type = document.getElementById("subType").value;
      const rawProof = document.getElementById("subProofUrl").value.trim();
      const rawFootage = document.getElementById("subRawUrl").value.trim();
      const device = document.getElementById("subDevice").value.trim();
      const notes = document.getElementById("subNotes").value.trim();

      const validProof = safeUrl(rawProof);
      if (!validProof) {
        alert("Please provide a valid HTTP/HTTPS proof URL.");
        return;
      }

      const playerName = currentProfile?.username 
                      || currentUser.user_metadata?.player_name 
                      || currentUser.email.split('@')[0];

      let payload = {
        user_id: currentUser.id,
        player_name: playerName,
        type: type,
        proof_url: validProof,
        raw_footage_url: safeUrl(rawFootage) || '',
        device: device,
        notes: notes,
        status: 'pending'
      };

      if (type === "verification") {
        payload.level_id = null;
        payload.percentage = 100;
        payload.level_name = document.getElementById("subNewLevelName").value.trim();
        payload.creator = document.getElementById("subNewLevelCreator").value.trim();
        payload.level_length = document.getElementById("subNewLevelLength").value.trim();
        payload.min_percentage = parseInt(document.getElementById("subNewLevelMinPct").value, 10) || 100;
        payload.level_description = document.getElementById("subNewLevelDesc").value.trim();
      } else {
        payload.level_id = parseInt(document.getElementById("subLevelSelect").value, 10);
        payload.percentage = parseInt(document.getElementById("subPercentage").value, 10);
      }

      const { error } = await supabaseClient.from('submissions').insert([payload]);

      if (error) {
        alert("Error submitting record: " + error.message);
      } else {
        alert("Record submitted successfully! It is now on hold in the queue.");
        recordSubForm.reset();
        document.getElementById("subType").value = "completion";
        document.getElementById("subType").dispatchEvent(new Event('change'));
        await refreshQueueState();
      }
    });
  }

  // 2. Manual Accept Submission Form
  const manualForm = document.getElementById("manualAcceptForm");
  if (manualForm) {
    manualForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!isModerator) return;

      const subId = document.getElementById("manSubId").value;
      const rank = parseInt(document.getElementById("manRank").value, 10);
      const name = document.getElementById("manName").value.trim();
      const creator = document.getElementById("manCreator").value.trim();
      const verifier = document.getElementById("manVerifier").value.trim();
      const length = document.getElementById("manLength").value.trim();
      const minPct = parseInt(document.getElementById("manMinPct").value, 10) || 100;
      const video = safeUrl(document.getElementById("manVideo").value.trim());
      const device = document.getElementById("manDevice").value.trim();
      const desc = document.getElementById("manDesc").value.trim();

      if (!video) {
        alert("Please enter a valid HTTP/HTTPS video URL.");
        return;
      }

      const sub = pendingSubmissionsCache.find(s => s.id == subId);

      const rankTaken = currentLevels.some(l => l.rank === rank && l.id !== sub?.level_id);
      if (rankTaken) {
        if (!confirm(`Warning: Rank #${rank} is currently occupied. Do you want to proceed inserting anyway?`)) {
          return;
        }
      }

      let targetLevelId = sub?.level_id;

      if (!targetLevelId || sub?.type === 'verification') {
        const { data: newLevel, error: lvlErr } = await supabaseClient
          .from('levels')
          .insert([{
            rank: rank,
            name: name,
            creator: creator,
            verifier: verifier,
            length: length,
            min_percentage: minPct,
            video_url: video,
            description: desc
          }])
          .select()
          .single();

        if (lvlErr) {
          alert("Error publishing level: " + lvlErr.message);
          return;
        }
        targetLevelId = newLevel.id;
      } else {
        await supabaseClient
          .from('levels')
          .update({
            rank: rank,
            name: name,
            creator: creator,
            verifier: verifier,
            length: length,
            min_percentage: minPct,
            video_url: video,
            description: desc
          })
          .eq('id', targetLevelId);
      }

      await supabaseClient.from('victors').insert([{
        level_id: targetLevelId,
        player_name: verifier,
        user_id: sub ? sub.user_id : null,
        percentage: sub ? sub.percentage : 100,
        proof_url: video,
        device: device
      }]);

      if (sub) {
        const modName = currentProfile?.username || "Moderator";
        await supabaseClient
          .from('submissions')
          .update({
            status: 'accepted',
            reviewed_by: modName,
            reviewed_at: new Date().toISOString()
          })
          .eq('id', sub.id);
      }

      await logModeratorAction(
        "MANUAL_ACCEPT_LEVEL",
        name,
        `Moderator manual-accepted level at #${rank} verified by ${verifier}`
      );

      alert(`Level "${name}" successfully placed at #${rank}!`);
      document.getElementById("manualAcceptModal").classList.remove("active");
      await fetchLevelsFromDB();
      await refreshQueueState();
    });
  }

  // 3. Update Bio
  document.getElementById("updateBioForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const newBio = document.getElementById("updateBioInput").value.trim();
    const { error } = await supabaseClient.from('profiles').update({ bio: newBio }).eq('id', currentUser.id);
    if (error) alert("Failed to save bio: " + error.message);
    else {
      if (currentProfile) currentProfile.bio = newBio;
      alert("Personal bio updated!");
      renderProfile();
    }
  });

  // 4. Direct Victor Add
  document.getElementById("addVictorForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isModerator) return;
    const levelId = document.getElementById("victorLevelSelect").value;
    const playerName = document.getElementById("victorPlayerName").value.trim();
    const percentage = parseInt(document.getElementById("victorPercentage").value, 10) || 100;
    const rawProof = document.getElementById("victorProofUrl").value.trim();
    const validatedProof = safeUrl(rawProof);
    const device = document.getElementById("victorDevice").value.trim();

    if (!validatedProof) {
      alert("Please enter a valid proof URL.");
      return;
    }

    const { error } = await supabaseClient.from('victors').insert([{
      level_id: levelId, player_name: playerName, percentage: percentage, proof_url: validatedProof, device: device
    }]);

    if (error) alert("Database error: " + error.message);
    else {
      await logModeratorAction("DIRECT_RECORD_ADD", playerName, `Added ${percentage}% on level ID ${levelId}`);
      alert(`Record added for ${playerName}!`);
      document.getElementById("addVictorForm").reset();
      await fetchLevelsFromDB();
    }
  });

  // 5. Direct Level Add
  document.getElementById("addLevelForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isModerator) return;
    const rank = parseInt(document.getElementById("levelRank").value, 10);
    const name = document.getElementById("levelName").value.trim();
    const length = document.getElementById("levelLength").value.trim();
    const minPct = parseInt(document.getElementById("levelMinPct").value, 10) || 100;
    const creator = document.getElementById("levelCreator").value.trim();
    const verifier = document.getElementById("levelVerifier").value.trim();
    const rawVideo = document.getElementById("levelVideo").value.trim();
    const validatedVideo = safeUrl(rawVideo);
    const description = document.getElementById("levelDescription").value.trim();

    if (!validatedVideo) {
      alert("Please enter a valid HTTP/HTTPS video URL.");
      return;
    }

    const { error: insertError } = await supabaseClient.from('levels').insert([{ 
      rank, name, length, min_percentage: minPct, creator, verifier, video_url: validatedVideo, description 
    }]);

    if (insertError) alert("Error adding level: " + insertError.message);
    else {
      await logModeratorAction("ADD_LEVEL", name, `Placed new level at #${rank} created by ${creator}`);
      alert(`Level ${name} successfully placed at #${rank}!`);
      document.getElementById("addLevelForm").reset();
      await fetchLevelsFromDB();
    }
  });
}

async function deleteVictor(victorId) {
  if (!isModerator) return;
  if (!confirm("Are you sure you want to remove this record?")) return;
  const { error } = await supabaseClient.from('victors').delete().eq('id', victorId);
  if (error) alert("Error deleting record: " + error.message);
  else {
    await logModeratorAction("DELETE_RECORD", "Record ID " + victorId, "Removed victor record from list");
    await fetchLevelsFromDB();
  }
}

function setupModModals() {
  const rejectModal = document.getElementById("rejectModal");
  document.getElementById("closeRejectModal").onclick = () => rejectModal.classList.remove("active");
  document.getElementById("rejectPreset").onchange = (e) => {
    if (e.target.value) document.getElementById("rejectCustomReason").value = e.target.value;
  };
  document.getElementById("confirmRejectBtn").onclick = async () => {
    const reason = document.getElementById("rejectCustomReason").value.trim();
    if (!reason) { alert("Rejection reason required."); return; }
    if (currentRejectSubmissionId) await denySubmission(currentRejectSubmissionId, reason);
  };

  document.getElementById("closeManualAcceptModal").onclick = () => {
    document.getElementById("manualAcceptModal").classList.remove("active");
  };

  const punishModal = document.getElementById("punishModal");
  document.getElementById("openPunishModalBtn")?.addEventListener("click", () => {
    if (!targetBanProfile) return;
    document.getElementById("punishReason").value = "";
    punishModal.classList.add("active");
  });
  document.getElementById("closePunishModal").onclick = () => punishModal.classList.remove("active");

  document.getElementById("confirmPunishBtn")?.addEventListener("click", async () => {
    if (!targetBanProfile || !isModerator) return;
    const duration = document.getElementById("punishDuration").value;
    const reason = document.getElementById("punishReason").value.trim();
    if (!reason) { alert("Please provide a reason."); return; }

    let timeoutDate = new Date();
    if (duration === "forever") timeoutDate.setFullYear(timeoutDate.getFullYear() + 50);
    else timeoutDate.setDate(timeoutDate.getDate() + parseInt(duration, 10));

    const { error } = await supabaseClient
      .from('profiles')
      .update({ submission_banned_until: timeoutDate.toISOString() })
      .eq('id', targetBanProfile.id);

    if (error) alert("Error applying timeout: " + error.message);
    else {
      await logModeratorAction("TIMEOUT_PLAYER", targetBanProfile.username, `Timeout (${duration}). Reason: "${reason}"`);
      alert(`Timeout applied to ${targetBanProfile.username}!`);
      punishModal.classList.remove("active");
      renderProfile();
    }
  });

  const banModal = document.getElementById("banModal");
  document.getElementById("openBanModalBtn")?.addEventListener("click", () => {
    if (!targetBanProfile) return;
    document.getElementById("banReasonInput").value = "";
    banModal.classList.add("active");
  });
  document.getElementById("closeBanModal").onclick = () => banModal.classList.remove("active");

  document.getElementById("confirmBanBtn")?.addEventListener("click", async () => {
    if (!targetBanProfile || !isModerator) return;
    const reason = document.getElementById("banReasonInput").value.trim();
    if (!reason) { alert("Reason required."); return; }
    if (!confirm(`Are you 100% sure you want to BAN ${targetBanProfile.username}?`)) return;

    const modName = currentProfile?.username || "Moderator";
    await supabaseClient.from('profiles').update({
      is_banned: true, ban_reason: reason, banned_at: new Date().toISOString(), banned_by: modName
    }).eq('id', targetBanProfile.id);

    await supabaseClient.from('victors').delete().eq('player_name', targetBanProfile.username);
    await supabaseClient.from('victors').delete().eq('user_id', targetBanProfile.id);
    await supabaseClient.from('levels').update({ verifier: 'Unknown' }).eq('verifier', targetBanProfile.username);

    await logModeratorAction("BAN_PLAYER", targetBanProfile.username, `Banned & purged records. Reason: "${reason}"`);
    alert(`Player ${targetBanProfile.username} banned.`);
    banModal.classList.remove("active");
    await fetchLevelsFromDB();
    renderProfile();
  });

  document.getElementById("unbanPlayerBtn")?.addEventListener("click", async () => {
    if (!targetBanProfile || !isModerator) return;
    if (!confirm(`Remove ban sanctions from ${targetBanProfile.username}?`)) return;
    await supabaseClient.from('profiles').update({
      is_banned: false, ban_reason: null, banned_at: null, banned_by: null, submission_banned_until: null
    }).eq('id', targetBanProfile.id);

    await logModeratorAction("UNBAN_PLAYER", targetBanProfile.username, "Lifted ban and sanctions.");
    alert(`${targetBanProfile.username} is unbanned.`);
    renderProfile();
  });
}

function setupNavigation() {
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenuWrapper");
  if (navToggle) {
    navToggle.addEventListener("click", () => {
      navMenu.classList.toggle("active");
    });
  }

  const modDropdownBtn = document.getElementById("modDropdownBtn");
  const modContainer = document.getElementById("modMenuDropdown");
  if (modDropdownBtn) {
    modDropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      modContainer.classList.toggle("open");
    });
    document.addEventListener("click", () => {
      modContainer.classList.remove("open");
    });
  }

  // Handle Tab Switch
  const allNavButtons = document.querySelectorAll(".nav-btn, .mod-dropdown-item");
  allNavButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!tab) return;

      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      if (btn.classList.contains("nav-btn")) btn.classList.add("active");

      if (navMenu) navMenu.classList.remove("active");
      if (modContainer) modContainer.classList.remove("open");

      currentTab = tab;
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      if (tab === "main" || tab === "extended") {
        document.getElementById("listView").classList.add("active");
        renderList();
      } else if (tab === "leaderboard") {
        document.getElementById("leaderboardView").classList.add("active");
        renderLeaderboard();
      } else if (tab === "submit") {
        document.getElementById("submitView").classList.add("active");
        checkSubmissionRestrictions();
      } else if (tab === "profile") {
        activeProfilePlayer = null; // Always open current user's profile when clicking the navbar tab
        document.getElementById("profileView").classList.add("active");
        renderProfile();
      } else if (tab === "rules") {
        document.getElementById("rulesView").classList.add("active");
      } else if (tab === "about") {
        document.getElementById("aboutView").classList.add("active");
      } else if (tab === "queue") {
        document.getElementById("queueView").classList.add("active");
        renderQueue();
      } else if (tab === "admin") {
        document.getElementById("adminView").classList.add("active");
      } else if (tab === "logs") {
        document.getElementById("logsView").classList.add("active");
        fetchAndRenderModLogs();
      }
    });
  });

  // Collapsible Dropdown Toggle for Submissions Tracker
  const subDropdownToggle = document.getElementById("submissionsDropdownToggle");
  if (subDropdownToggle) {
    subDropdownToggle.addEventListener("click", () => {
      const content = document.getElementById("submissionsDropdownContent");
      const isOpen = content.style.display !== "none";

      if (isOpen) {
        content.style.display = "none";
        subDropdownToggle.setAttribute("aria-expanded", "false");
      } else {
        content.style.display = "block";
        subDropdownToggle.setAttribute("aria-expanded", "true");
      }
    });
  }

  document.getElementById("queueTypeFilter")?.addEventListener("change", renderQueue);
  document.getElementById("queueOrderFilter")?.addEventListener("change", renderQueue);
}

function setupSearch() {
  const input = document.getElementById("searchInput");
  input?.addEventListener("input", () => renderList());
}

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
    const identifier = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    let emailToUse = identifier.includes("@") ? identifier.toLowerCase() : usernameToEmail(identifier);

    errorEl.textContent = "Signing in...";
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: emailToUse, password: password
    });

    if (error) {
      errorEl.textContent = "Invalid username/email or password.";
      return;
    }

    modal.classList.remove("active");
    await checkAuthSession();
    await refreshQueueState();
    renderList();
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("signupUsername").value.trim();
    const password = document.getElementById("signupPassword").value;

    if (!isValidUsername(username)) {
      errorEl.textContent = "Username must be 3-20 characters long (letters, numbers, underscores).";
      return;
    }

    const pseudoEmail = usernameToEmail(username);
    errorEl.textContent = "Creating account...";

    const { data, error } = await supabaseClient.auth.signUp({
      email: pseudoEmail,
      password: password,
      options: { data: { player_name: username } }
    });

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    if (data.session) {
      modal.classList.remove("active");
      await checkAuthSession();
      await refreshQueueState();
      renderList();
      alert(`Welcome to ANL, ${username}!`);
    } else {
      errorEl.textContent = "Registered! You can now log in.";
      tabLoginBtn.click();
    }
  });
}