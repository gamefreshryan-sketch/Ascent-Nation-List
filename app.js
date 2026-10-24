/**
 * Ascent Nation List (ANL)
 * Complete Application Logic
 */

// ==========================================
// 1. GLOBAL STATE & SUPABASE CLIENT SETUP
// ==========================================
// Named supabaseClient to prevent collision with window.supabase from the CDN
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let state = {
  currentTab: 'main',
  levels: [],
  selectedLevel: null,
  currentUser: null,
  currentProfile: null,
  viewingProfileUsername: null,
  profileSortMode: 'rank',
  allPendingSubmissions: [],
  allSubmissions: [],
  modLogs: []
};

// ==========================================
// 2. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupModSubtabs();
  setupAuth();
  setupSubmissionsSystem();
  setupProfileModeration();
  await checkSession();
  await loadLevels();
});

// ==========================================
// 3. NAVIGATION & TABS
// ==========================================
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      switchTab(tab);
    });
  });

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => filterLevels(e.target.value));
  }

  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.profileSortMode = e.target.dataset.sort;
      if (state.viewingProfileUsername) {
        renderProfile(state.viewingProfileUsername);
      }
    });
  });

  const backMyProfileBtn = document.getElementById('viewMyProfileBtn');
  if (backMyProfileBtn) {
    backMyProfileBtn.addEventListener('click', () => {
      if (state.currentProfile) {
        openProfile(state.currentProfile.username);
      }
    });
  }
}

function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('.tab-content').forEach(view => view.classList.remove('active'));

  if (tabId === 'main') {
    document.getElementById('listView').classList.add('active');
    renderLevelList(1, 50);
  } else if (tabId === 'extended') {
    document.getElementById('listView').classList.add('active');
    renderLevelList(51, 9999);
  } else if (tabId === 'leaderboard') {
    document.getElementById('leaderboardView').classList.add('active');
    renderLeaderboard();
  } else if (tabId === 'rules') {
    document.getElementById('rulesView').classList.add('active');
  } else if (tabId === 'profile') {
    document.getElementById('profileView').classList.add('active');
    const targetUser = state.viewingProfileUsername || (state.currentProfile ? state.currentProfile.username : null);
    if (targetUser) {
      renderProfile(targetUser);
    } else {
      document.getElementById('profilePlayerName').textContent = 'Please Sign In';
      document.getElementById('profileBioDisplay').textContent = 'Sign in or register to view your personal stats, submit records, and check your queue position.';
    }
  } else if (tabId === 'admin') {
    if (!state.currentProfile || !state.currentProfile.is_mod) {
      alert('Access restricted to verified moderators.');
      switchTab('main');
      return;
    }
    document.getElementById('adminView').classList.add('active');
    loadAdminSubmissionsQueue();
    loadModAuditLogs();
    populateAdminDropdown();
  }
}

function setupModSubtabs() {
  document.querySelectorAll('.admin-subtab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.admin-subtab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-subcontent').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      const targetSubtab = e.target.dataset.subtab;
      document.getElementById(`${targetSubtab}Tab`).classList.add('active');
      if (targetSubtab === 'modQueue') loadAdminSubmissionsQueue();
      if (targetSubtab === 'modLogs') loadModAuditLogs();
    });
  });

  const filterStatus = document.getElementById('queueFilterStatus');
  const filterType = document.getElementById('queueFilterType');
  const sortOrder = document.getElementById('queueSortOrder');
  const refreshBtn = document.getElementById('refreshQueueBtn');
  const refreshLogsBtn = document.getElementById('refreshLogsBtn');

  if (filterStatus) filterStatus.addEventListener('change', renderFilteredAdminQueue);
  if (filterType) filterType.addEventListener('change', renderFilteredAdminQueue);
  if (sortOrder) sortOrder.addEventListener('change', renderFilteredAdminQueue);
  if (refreshBtn) refreshBtn.addEventListener('click', loadAdminSubmissionsQueue);
  if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', loadModAuditLogs);
}

// ==========================================
// 4. AUTH & BAN / TIMEOUT ENFORCEMENT
// ==========================================
function setupAuth() {
  const authModal = document.getElementById('authModal');
  const authBtn = document.getElementById('authBtn');
  const closeAuthBtn = document.getElementById('closeAuthModal');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabSignupBtn = document.getElementById('tabSignupBtn');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const authError = document.getElementById('authError');

  authBtn.addEventListener('click', async () => {
    if (state.currentUser) {
      await supabaseClient.auth.signOut();
      state.currentUser = null;
      state.currentProfile = null;
      updateAuthUI();
      switchTab('main');
    } else {
      authModal.classList.add('active');
      authError.textContent = '';
    }
  });

  closeAuthBtn.addEventListener('click', () => authModal.classList.remove('active'));

  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabSignupBtn.classList.remove('active');
    loginForm.style.display = 'block';
    signupForm.style.display = 'none';
    authError.textContent = '';
  });

  tabSignupBtn.addEventListener('click', () => {
    tabSignupBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    authError.textContent = '';
  });

  // SIGN IN
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = 'Authenticating...';
    const rawUsername = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const internalEmail = `${rawUsername.toLowerCase()}@ascentnation.internal`;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: internalEmail,
      password: password
    });

    if (error) {
      authError.textContent = error.message;
      return;
    }

    // CHECK IF USER IS BANNED
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profile && profile.is_banned) {
      await supabaseClient.auth.signOut();
      state.currentUser = null;
      state.currentProfile = null;
      authError.innerHTML = `⛔ <strong>Account Banned:</strong> ${escapeHtml(profile.ban_reason || 'Violation of list integrity rules')}.<br><span style="font-size:0.8rem;color:#94a3b8;">Accounts are preserved for appeals. Contact Ascent Nation moderators if you believe this is a false ban.</span>`;
      return;
    }

    state.currentUser = data.user;
    state.currentProfile = profile;
    authModal.classList.remove('active');
    loginForm.reset();
    updateAuthUI();
  });

  // SIGN UP
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = 'Registering account...';
    const rawUsername = document.getElementById('signupUsername').value.trim();
    const password = document.getElementById('signupPassword').value;

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(rawUsername)) {
      authError.textContent = 'Username must be 3-20 characters (letters, numbers, underscores only).';
      return;
    }

    const internalEmail = `${rawUsername.toLowerCase()}@ascentnation.internal`;

    const { data, error } = await supabaseClient.auth.signUp({
      email: internalEmail,
      password: password,
      options: { data: { username: rawUsername } }
    });

    if (error) {
      authError.textContent = error.message;
      return;
    }

    const { error: insertProfileErr } = await supabaseClient.from('profiles').insert([
      { id: data.user.id, username: rawUsername }
    ]);

    if (insertProfileErr) {
      authError.textContent = 'Account created, but profile setup failed: ' + insertProfileErr.message;
      return;
    }

    state.currentUser = data.user;
    await checkSession();
    authModal.classList.remove('active');
    signupForm.reset();
  });

  // BIO FORM
  const updateBioForm = document.getElementById('updateBioForm');
  if (updateBioForm) {
    updateBioForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.currentUser) return;
      const newBio = document.getElementById('updateBioInput').value.trim();
      const { error } = await supabaseClient
        .from('profiles')
        .update({ bio: newBio })
        .eq('id', state.currentUser.id);
      if (!error) {
        state.currentProfile.bio = newBio;
        document.getElementById('profileBioDisplay').textContent = newBio || 'No bio set.';
        alert('Bio updated successfully!');
      }
    });
  }
}

async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (profile && profile.is_banned) {
      await supabaseClient.auth.signOut();
      state.currentUser = null;
      state.currentProfile = null;
      showAccountBanner(`⛔ Your account is banned: ${profile.ban_reason}. Submissions and list changes are disabled.`);
    } else {
      state.currentUser = session.user;
      state.currentProfile = profile;
      checkUserRestrictions();
    }
  }
  updateAuthUI();
}

function checkUserRestrictions() {
  const banner = document.getElementById('accountBanner');
  if (!state.currentProfile) {
    banner.style.display = 'none';
    return;
  }

  if (state.currentProfile.submission_banned_until) {
    const timeoutDate = new Date(state.currentProfile.submission_banned_until);
    if (timeoutDate > new Date()) {
      showAccountBanner(`⏱️ Submissions Restricted: You cannot submit new records until ${timeoutDate.toLocaleString()} due to moderator punishment.`);
      return;
    }
  }
  banner.style.display = 'none';
}

function showAccountBanner(msg) {
  const banner = document.getElementById('accountBanner');
  banner.innerHTML = msg;
  banner.style.display = 'block';
}

function updateAuthUI() {
  const authBtn = document.getElementById('authBtn');
  const adminTabBtn = document.getElementById('adminTabBtn');
  const openSubmitBtn = document.getElementById('openSubmitModalBtn');
  const bioEditCard = document.getElementById('bioEditCard');

  if (state.currentUser && state.currentProfile) {
    authBtn.textContent = `Sign Out (${state.currentProfile.username})`;
    openSubmitBtn.style.display = 'inline-block';
    if (bioEditCard) bioEditCard.style.display = 'block';

    if (state.currentProfile.is_mod) {
      adminTabBtn.style.display = 'inline-block';
    } else {
      adminTabBtn.style.display = 'none';
    }
  } else {
    authBtn.textContent = 'Sign In / Register';
    openSubmitBtn.style.display = 'none';
    adminTabBtn.style.display = 'none';
    if (bioEditCard) bioEditCard.style.display = 'none';
  }
}

// ==========================================
// 5. USER SUBMISSIONS (FIFO QUEUE & 3-LIMIT)
// ==========================================
function setupSubmissionsSystem() {
  const submitModal = document.getElementById('submitRecordModal');
  const openSubmitBtn = document.getElementById('openSubmitModalBtn');
  const closeSubmitBtn = document.getElementById('closeSubmitModal');
  const submitRecordForm = document.getElementById('submitRecordForm');
  const submitError = document.getElementById('submissionError');

  openSubmitBtn.addEventListener('click', () => {
    if (!state.currentUser) {
      alert('Please log in to submit a record.');
      return;
    }

    if (state.currentProfile.is_banned) {
      alert(`Your account has been banned: ${state.currentProfile.ban_reason}`);
      return;
    }

    if (state.currentProfile.submission_banned_until) {
      const banExpires = new Date(state.currentProfile.submission_banned_until);
      if (banExpires > new Date()) {
        alert(`You are restricted from submitting records until ${banExpires.toLocaleString()}.`);
        return;
      }
    }

    populateSubmitLevelDropdown();
    submitModal.classList.add('active');
    submitError.textContent = '';
  });

  closeSubmitBtn.addEventListener('click', () => submitModal.classList.remove('active'));

  submitRecordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitError.textContent = 'Submitting record for review...';

    const type = document.getElementById('submissionType').value;
    const levelId = parseInt(document.getElementById('submissionLevelSelect').value, 10);
    const percentage = parseInt(document.getElementById('submissionPercentage').value, 10);
    const proofUrl = document.getElementById('submissionProofUrl').value.trim();
    const rawUrl = document.getElementById('submissionRawUrl').value.trim();
    const device = document.getElementById('submissionDevice').value.trim();
    const notes = document.getElementById('submissionNotes').value.trim();

    const targetLevel = state.levels.find(l => l.id === levelId);
    if (targetLevel && percentage < targetLevel.min_pct && percentage < 100) {
      submitError.textContent = `Minimum qualifying requirement for "${targetLevel.name}" is ${targetLevel.min_pct}%.`;
      return;
    }

    // Enforce 3 pending submissions limit
    const { count: pendingCount, error: countErr } = await supabaseClient
      .from('submissions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', state.currentUser.id)
      .eq('status', 'pending');

    if (countErr) {
      submitError.textContent = 'Database error checking queue limit: ' + countErr.message;
      return;
    }

    if (pendingCount >= 3) {
      submitError.textContent = 'Queue limit reached! You already have 3 submissions on hold. Please wait until moderators review your existing submissions.';
      return;
    }

    // Insert into submissions queue
    const { error: insertErr } = await supabaseClient.from('submissions').insert([{
      user_id: state.currentUser.id,
      player_name: state.currentProfile.username,
      type: type,
      level_id: levelId,
      percentage: percentage,
      proof_url: proofUrl,
      raw_footage_url: rawUrl,
      device: device,
      notes: notes,
      status: 'pending'
    }]);

    if (insertErr) {
      submitError.textContent = 'Submission failed: ' + insertErr.message;
      return;
    }

    alert('Your submission has been queued on hold for moderator review! You can track its FIFO queue position on your profile.');
    submitRecordForm.reset();
    submitModal.classList.remove('active');

    if (state.currentTab === 'profile') {
      renderProfile(state.currentProfile.username);
    }
  });
}

function populateSubmitLevelDropdown() {
  const select = document.getElementById('submissionLevelSelect');
  select.innerHTML = '';
  state.levels.forEach(lvl => {
    const opt = document.createElement('option');
    opt.value = lvl.id;
    opt.textContent = `#${lvl.rank} - ${lvl.name} (Req: ${lvl.min_pct}%)`;
    select.appendChild(opt);
  });
}

// ==========================================
// 6. MODERATOR QUEUE, DENY & AUDIT LOGS
// ==========================================
async function loadAdminSubmissionsQueue() {
  const container = document.getElementById('submissionsQueueContainer');
  container.innerHTML = '<div class="loading">Loading queue submissions...</div>';

  const { data, error } = await supabaseClient
    .from('submissions')
    .select('*, levels(name, rank, min_pct)')
    .order('created_at', { ascending: true });

  if (error) {
    container.innerHTML = `<div class="login-error">Error fetching queue: ${error.message}</div>`;
    return;
  }

  state.allSubmissions = data || [];
  state.allPendingSubmissions = state.allSubmissions.filter(s => s.status === 'pending');

  const countBadge = document.getElementById('modQueueCount');
  if (countBadge) countBadge.textContent = state.allPendingSubmissions.length;

  renderFilteredAdminQueue();
}

function renderFilteredAdminQueue() {
  const container = document.getElementById('submissionsQueueContainer');
  const statusFilter = document.getElementById('queueFilterStatus').value;
  const typeFilter = document.getElementById('queueFilterType').value;
  const sortOrder = document.getElementById('queueSortOrder').value;

  let filtered = [...state.allSubmissions];

  if (statusFilter !== 'all') {
    filtered = filtered.filter(s => s.status === statusFilter);
  }

  if (typeFilter !== 'all') {
    filtered = filtered.filter(s => s.type === typeFilter);
  }

  if (sortOrder === 'newest') {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else {
    filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding:20px;">No submissions found for selected filters.</p>';
    return;
  }

  container.innerHTML = '';

  filtered.forEach(sub => {
    const card = document.createElement('div');
    card.className = 'queue-card';

    let queuePositionHtml = '';
    if (sub.status === 'pending') {
      const pos = state.allPendingSubmissions.findIndex(item => item.id === sub.id) + 1;
      queuePositionHtml = `<span class="queue-badge">Queue Position #${pos} (FIFO)</span>`;
    }

    const levelName = sub.levels ? `#${sub.levels.rank} - ${sub.levels.name}` : `Level ID #${sub.level_id}`;
    const statusBadgeClass = sub.status === 'pending' ? 'badge-pending' : (sub.status === 'accepted' ? 'badge-accepted' : 'badge-rejected');

    card.innerHTML = `
      <div class="queue-card-header">
        <div class="queue-header-left">
          ${queuePositionHtml}
          <span class="pct-badge ${sub.percentage === 100 ? 'pct-100' : 'pct-partial'}">${sub.percentage}%</span>
          <strong>${escapeHtml(levelName)}</strong>
          <span class="user-badge">[${sub.type.toUpperCase()}]</span>
        </div>
        <div>
          <span class="status-badge ${statusBadgeClass}">${sub.status}</span>
        </div>
      </div>

      <div class="queue-card-body">
        <div>
          <p><strong>Submitted by:</strong> <a class="player-link" onclick="openProfile('${escapeHtml(sub.player_name)}')">${escapeHtml(sub.player_name)}</a></p>
          <p><strong>Device:</strong> ${escapeHtml(sub.device)}</p>
          <div class="queue-links-col">
            <a href="${escapeHtml(sub.proof_url)}" target="_blank" rel="noopener">📺 Watch Video Proof</a>
            ${sub.raw_footage_url ? `<a href="${escapeHtml(sub.raw_footage_url)}" target="_blank" rel="noopener">📁 Raw Footage</a>` : '<span class="text-muted">(No raw footage linked)</span>'}
          </div>
          ${sub.notes ? `<div class="queue-notes-text"><strong>Player Notes:</strong> ${escapeHtml(sub.notes)}</div>` : ''}
          ${sub.rejection_reason ? `<div class="reason-box-rejected"><strong>Rejection Reason:</strong> ${escapeHtml(sub.rejection_reason)} (By ${escapeHtml(sub.reviewed_by || 'Mod')})</div>` : ''}
        </div>
        <div style="text-align: right; font-size: 0.8rem;" class="text-muted">
          <div>Submitted: ${new Date(sub.created_at).toLocaleString()}</div>
          ${sub.reviewed_at ? `<div>Reviewed: ${new Date(sub.reviewed_at).toLocaleString()}</div>` : ''}
        </div>
      </div>

      ${sub.status === 'pending' ? `
        <div class="queue-card-actions">
          <button class="btn-punish-small" onclick="openPunishModal('${sub.user_id}', '${escapeHtml(sub.player_name)}')">⏱️ Restrict Submissions</button>
          <button class="btn-deny" onclick="openDenyModal(${sub.id})">❌ Deny with Reason</button>
          <button class="btn-accept" onclick="acceptSubmission(${sub.id})">✅ Accept & Add to List</button>
        </div>
      ` : ''}
    `;

    container.appendChild(card);
  });
}

// ACCEPT SUBMISSION
async function acceptSubmission(submissionId) {
  if (!confirm('Are you sure you want to approve this submission and publish it to ANL?')) return;

  const sub = state.allSubmissions.find(s => s.id === submissionId);
  if (!sub) return;

  try {
    const { error: victorErr } = await supabaseClient.from('victors').insert([{
      level_id: sub.level_id,
      player_name: sub.player_name,
      user_id: sub.user_id,
      percentage: sub.percentage,
      proof_url: sub.proof_url,
      device: sub.device
    }]);

    if (victorErr) throw victorErr;

    if (sub.type === 'verification' && sub.percentage === 100) {
      await supabaseClient
        .from('levels')
        .update({ verifier: sub.player_name, video_url: sub.proof_url })
        .eq('id', sub.level_id);
    }

    const { error: subErr } = await supabaseClient
      .from('submissions')
      .update({
        status: 'accepted',
        reviewed_by: state.currentProfile.username,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', submissionId);

    if (subErr) throw subErr;

    await logModeratorAction(
      'ACCEPT_SUBMISSION',
      sub.player_name,
      `Accepted ${sub.type} (${sub.percentage}%) on Level ID #${sub.level_id}`
    );

    alert('Submission successfully approved and published to ANL!');
    await loadLevels();
    loadAdminSubmissionsQueue();
  } catch (err) {
    alert('Error accepting submission: ' + err.message);
  }
}

// SETUP DENY MODAL
function openDenyModal(submissionId) {
  const modal = document.getElementById('denyModal');
  document.getElementById('denySubmissionId').value = submissionId;
  document.getElementById('denyReasonDetail').value = document.getElementById('denyPresetSelect').value;
  modal.classList.add('active');
}

const denyForm = document.getElementById('denyForm');
if (denyForm) {
  const presetSelect = document.getElementById('denyPresetSelect');
  const reasonText = document.getElementById('denyReasonDetail');

  presetSelect.addEventListener('change', () => {
    if (presetSelect.value !== 'CUSTOM') {
      reasonText.value = presetSelect.value;
    } else {
      reasonText.value = '';
      reasonText.focus();
    }
  });

  denyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submissionId = parseInt(document.getElementById('denySubmissionId').value, 10);
    const finalReason = reasonText.value.trim();

    if (!finalReason) {
      alert('A detailed explanation is required when rejecting a submission.');
      return;
    }

    const sub = state.allSubmissions.find(s => s.id === submissionId);

    const { error } = await supabaseClient
      .from('submissions')
      .update({
        status: 'rejected',
        rejection_reason: finalReason,
        reviewed_by: state.currentProfile.username,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', submissionId);

    if (error) {
      alert('Error denying submission: ' + error.message);
      return;
    }

    if (sub) {
      await logModeratorAction(
        'REJECT_SUBMISSION',
        sub.player_name,
        `Rejected ${sub.type} (${sub.percentage}%) on Level ID #${sub.level_id}. Reason: ${finalReason}`
      );
    }

    alert('Submission denied and player notified via their private dashboard.');
    document.getElementById('denyModal').classList.remove('active');
    loadAdminSubmissionsQueue();
  });

  document.getElementById('closeDenyModal').addEventListener('click', () => {
    document.getElementById('denyModal').classList.remove('active');
  });
}

// ==========================================
// 7. PUNISHMENT (SUBMISSION TIMEOUT) & ACCOUNT BAN
// ==========================================
function setupProfileModeration() {
  const punishModal = document.getElementById('punishModal');
  const banModal = document.getElementById('banModal');
  const closePunish = document.getElementById('closePunishModal');
  const closeBan = document.getElementById('closeBanModal');

  if (closePunish) closePunish.addEventListener('click', () => punishModal.classList.remove('active'));
  if (closeBan) closeBan.addEventListener('click', () => banModal.classList.remove('active'));

  // PUNISH FORM
  const punishForm = document.getElementById('punishForm');
  if (punishForm) {
    punishForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUserId = document.getElementById('punishTargetUserId').value;
      const targetName = document.getElementById('punishTargetName').value;
      const duration = document.getElementById('punishDuration').value;
      const reason = document.getElementById('punishReason').value.trim();

      let timeoutDate = new Date();
      if (duration === '1_day') timeoutDate.setDate(timeoutDate.getDate() + 1);
      else if (duration === '3_days') timeoutDate.setDate(timeoutDate.getDate() + 3);
      else if (duration === '7_days') timeoutDate.setDate(timeoutDate.getDate() + 7);
      else if (duration === '1_month') timeoutDate.setMonth(timeoutDate.getMonth() + 1);
      else if (duration === 'forever') timeoutDate = new Date('2099-12-31T23:59:59Z');

      const { error } = await supabaseClient
        .from('profiles')
        .update({ submission_banned_until: timeoutDate.toISOString() })
        .eq('id', targetUserId);

      if (error) {
        alert('Error applying restriction: ' + error.message);
        return;
      }

      await logModeratorAction(
        'SUBMISSION_TIMEOUT',
        targetName,
        `Restricted submissions for ${duration}. Reason: ${reason}`
      );

      alert(`Submission restriction applied to ${targetName} until ${timeoutDate.toLocaleString()}`);
      punishModal.classList.remove('active');
      renderProfile(targetName);
    });
  }

  // BAN FORM
  const banForm = document.getElementById('banForm');
  if (banForm) {
    banForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUserId = document.getElementById('banTargetUserId').value;
      const targetName = document.getElementById('banTargetName').value;
      const reason = document.getElementById('banReason').value.trim();
      const wipeRecords = document.getElementById('banWipeRecordsCheckbox').checked;

      // Never delete account - mark is_banned = true
      const { error: banErr } = await supabaseClient
        .from('profiles')
        .update({
          is_banned: true,
          ban_reason: reason,
          banned_at: new Date().toISOString(),
          banned_by: state.currentProfile.username
        })
        .eq('id', targetUserId);

      if (banErr) {
        alert('Error banning account: ' + banErr.message);
        return;
      }

      if (wipeRecords) {
        await supabaseClient.from('victors').delete().eq('player_name', targetName);
        await supabaseClient.from('levels').update({ verifier: 'Former Verifier (Banned)' }).eq('verifier', targetName);
      }

      await logModeratorAction(
        'ACCOUNT_BAN',
        targetName,
        `Account Banned. Reason: ${reason}. Records wiped: ${wipeRecords ? 'Yes' : 'No'}`
      );

      alert(`Account ${targetName} has been banned.`);
      banModal.classList.remove('active');
      await loadLevels();
      renderProfile(targetName);
    });
  }

  // UNBAN BUTTON
  const profileUnbanBtn = document.getElementById('profileUnbanBtn');
  if (profileUnbanBtn) {
    profileUnbanBtn.addEventListener('click', async () => {
      const targetName = state.viewingProfileUsername;
      if (!confirm(`Are you sure you want to lift the ban on ${targetName}?`)) return;

      const { data: userProfile } = await supabaseClient
        .from('profiles')
        .select('id')
        .eq('username', targetName)
        .single();

      if (!userProfile) return;

      const { error } = await supabaseClient
        .from('profiles')
        .update({
          is_banned: false,
          ban_reason: null,
          banned_at: null,
          banned_by: null,
          submission_banned_until: null
        })
        .eq('id', userProfile.id);

      if (error) {
        alert('Error unbanning: ' + error.message);
        return;
      }

      await logModeratorAction('ACCOUNT_UNBAN', targetName, 'Ban lifted by moderator.');
      alert(`${targetName} has been unbanned.`);
      renderProfile(targetName);
    });
  }
}

function openPunishModal(userId, username) {
  const modal = document.getElementById('punishModal');
  document.getElementById('punishTargetUserId').value = userId;
  document.getElementById('punishTargetName').value = username;
  document.getElementById('punishTargetUsername').textContent = username;
  document.getElementById('punishReason').value = '';
  modal.classList.add('active');
}

function openBanModal(userId, username) {
  const modal = document.getElementById('banModal');
  document.getElementById('banTargetUserId').value = userId;
  document.getElementById('banTargetName').value = username;
  document.getElementById('banTargetUsername').textContent = username;
  document.getElementById('banReason').value = '';
  modal.classList.add('active');
}

// AUDIT LOGGING HELPER
async function logModeratorAction(action, targetName, details) {
  if (!state.currentProfile) return;
  await supabaseClient.from('mod_logs').insert([{
    mod_id: state.currentUser.id,
    mod_username: state.currentProfile.username,
    action: action,
    target_name: targetName,
    details: details
  }]);
}

// LOAD AUDIT LOGS TABLE
async function loadModAuditLogs() {
  const tbody = document.getElementById('modLogsBody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading logs...</td></tr>';

  const { data, error } = await supabaseClient
    .from('mod_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="login-error">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">No moderation actions recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  data.forEach(log => {
    const tr = document.createElement('tr');
    let badgeClass = 'log-action-accept';
    if (log.action.includes('REJECT')) badgeClass = 'log-action-reject';
    if (log.action.includes('BAN')) badgeClass = 'log-action-ban';
    if (log.action.includes('TIMEOUT')) badgeClass = 'log-action-timeout';

    tr.innerHTML = `
      <td>${new Date(log.created_at).toLocaleString()}</td>
      <td><strong>${escapeHtml(log.mod_username)}</strong></td>
      <td><span class="log-action-badge ${badgeClass}">${escapeHtml(log.action)}</span></td>
      <td>${escapeHtml(log.target_name || '--')}</td>
      <td>${escapeHtml(log.details)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// 8. DATA LOADING & LEADERBOARD
// ==========================================
async function loadLevels() {
  const { data: levels, error } = await supabaseClient
    .from('levels')
    .select('*, victors(*)')
    .order('rank', { ascending: true });

  if (error) {
    document.getElementById('levelList').innerHTML = `<div class="login-error">${error.message}</div>`;
    return;
  }

  state.levels = levels || [];
  renderLevelList(1, 50);

  if (state.levels.length > 0) {
    selectLevel(state.levels[0].id);
  }
}

function renderLevelList(minRank, maxRank) {
  const listEl = document.getElementById('levelList');
  listEl.innerHTML = '';

  const filtered = state.levels.filter(l => l.rank >= minRank && l.rank <= maxRank);

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="loading">No levels in this range.</div>';
    return;
  }

  filtered.forEach(lvl => {
    const item = document.createElement('div');
    item.className = `level-item ${state.selectedLevel && state.selectedLevel.id === lvl.id ? 'active' : ''}`;
    item.dataset.id = lvl.id;

    const ytId = extractYouTubeId(lvl.video_url);
    const thumbUrl = ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : '';
    const points = calculatePoints(lvl.rank, 100);

    item.innerHTML = `
      <div class="item-bg-thumb" style="background-image: url('${thumbUrl}');"></div>
      <div class="item-overlay"></div>
      <div class="item-content">
        <div class="item-title-row">
          <span class="item-rank">#${lvl.rank}</span>
          <span class="item-name">${escapeHtml(lvl.name)}</span>
        </div>
        <div class="item-meta-row">
          <span>by ${escapeHtml(lvl.creator)}</span>
          <span class="item-sep">•</span>
          <span class="item-verifier">${escapeHtml(lvl.verifier)}</span>
        </div>
        <div class="item-points-row">
          <span class="item-points-label">${points.toFixed(2)} pts</span>
        </div>
      </div>
    `;

    item.addEventListener('click', () => selectLevel(lvl.id));
    listEl.appendChild(item);
  });
}

function selectLevel(id) {
  const lvl = state.levels.find(l => l.id === id);
  if (!lvl) return;
  state.selectedLevel = lvl;

  document.querySelectorAll('.level-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.id, 10) === id);
  });

  const detailPane = document.getElementById('levelDetails');
  const ytId = extractYouTubeId(lvl.video_url);
  const basePoints = calculatePoints(lvl.rank, 100);

  const victors = lvl.victors || [];
  let victorsListHtml = '';
  if (victors.length === 0) {
    victorsListHtml = '<p class="text-muted" style="padding: 10px;">No records recorded yet.</p>';
  } else {
    victorsListHtml = victors.map(v => `
      <div class="victor-row">
        <div>
          <a class="player-link" onclick="openProfile('${escapeHtml(v.player_name)}')">${escapeHtml(v.player_name)}</a>
          <span class="pct-badge ${v.percentage === 100 ? 'pct-100' : 'pct-partial'}">${v.percentage}%</span>
          <span class="text-muted" style="font-size:0.8rem; margin-left: 8px;">(${escapeHtml(v.device)})</span>
        </div>
        <div>
          <a href="${escapeHtml(v.proof_url)}" target="_blank" rel="noopener">Proof</a>
          ${state.currentProfile && state.currentProfile.is_mod ? `<button class="delete-victor-btn" onclick="deleteVictor(${v.id})">🗑️</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  detailPane.innerHTML = `
    <div class="level-header">
      <div class="level-title-group">
        <h2>#${lvl.rank} ${escapeHtml(lvl.name)}</h2>
        <p>Published by <strong>${escapeHtml(lvl.creator)}</strong> • Verified by <strong style="color:var(--success);">${escapeHtml(lvl.verifier)}</strong></p>
      </div>
      <div class="points-pill">${basePoints.toFixed(2)} pts</div>
    </div>

    ${ytId ? `
      <div class="video-wrapper">
        <iframe src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>
      </div>
    ` : ''}

    <div class="stats-grid">
      <div class="stat-card">
        <span>Level Length</span>
        <strong>${escapeHtml(lvl.length)}</strong>
      </div>
      <div class="stat-card">
        <span>List Requirement</span>
        <strong>${lvl.min_pct}%</strong>
      </div>
      <div class="stat-card">
        <span>Total Victors</span>
        <strong>${victors.length}</strong>
      </div>
    </div>

    ${lvl.description ? `<p class="text-muted" style="margin-bottom: 20px;">${escapeHtml(lvl.description)}</p>` : ''}

    <div class="victors-card">
      <h3 style="font-family: var(--font-heading); margin-bottom: 12px;">Recorded Victors & Progress</h3>
      ${victorsListHtml}
    </div>
  `;
}

// DELETE VICTOR (MOD DIRECT ACTION)
async function deleteVictor(victorId) {
  if (!confirm('Remove this victor record?')) return;
  const { error } = await supabaseClient.from('victors').delete().eq('id', victorId);
  if (!error) {
    await logModeratorAction('DELETE_RECORD', '', `Deleted record ID #${victorId}`);
    await loadLevels();
    if (state.selectedLevel) selectLevel(state.selectedLevel.id);
  }
}

// ==========================================
// 9. PLAYER PROFILE & PRIVATE SUBMISSIONS VIEW
// ==========================================
window.openProfile = function(username) {
  state.viewingProfileUsername = username;
  switchTab('profile');
};

async function renderProfile(username) {
  document.getElementById('profilePlayerName').textContent = username;
  document.getElementById('profileAvatar').textContent = username.charAt(0).toUpperCase();

  const isOwnProfile = state.currentProfile && state.currentProfile.username.toLowerCase() === username.toLowerCase();
  const isMod = state.currentProfile && state.currentProfile.is_mod;

  const toolbar = document.getElementById('profileToolbar');
  if (toolbar) toolbar.style.display = (!isOwnProfile && state.currentProfile) ? 'block' : 'none';

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  const banBadge = document.getElementById('profileBannedBadge');
  const timeoutBadge = document.getElementById('profileTimeoutBadge');
  const banNotice = document.getElementById('profileBanNotice');
  const modBar = document.getElementById('profileModActionsCard');
  const unbanBtn = document.getElementById('profileUnbanBtn');
  const banBtn = document.getElementById('profileBanBtn');
  const punishBtn = document.getElementById('profilePunishBtn');

  banBadge.style.display = 'none';
  timeoutBadge.style.display = 'none';
  banNotice.style.display = 'none';

  if (profile) {
    document.getElementById('profileBioDisplay').textContent = profile.bio || 'No bio set.';
    document.getElementById('profileBadge').textContent = profile.is_mod ? '🛡️ List Moderator' : 'Player';

    if (profile.is_banned) {
      banBadge.style.display = 'inline-block';
      banNotice.style.display = 'block';
      banNotice.innerHTML = `⛔ <strong>Account Banned:</strong> ${escapeHtml(profile.ban_reason)} <br><span style="font-size:0.75rem;">Banned by ${escapeHtml(profile.banned_by || 'Staff')} on ${new Date(profile.banned_at).toLocaleDateString()}</span>`;
    } else if (profile.submission_banned_until && new Date(profile.submission_banned_until) > new Date()) {
      timeoutBadge.style.display = 'inline-block';
      banNotice.style.display = 'block';
      banNotice.innerHTML = `⏱️ <strong>Submissions Restricted</strong> until ${new Date(profile.submission_banned_until).toLocaleString()}.`;
    }

    if (isMod && !isOwnProfile) {
      modBar.style.display = 'flex';
      punishBtn.onclick = () => openPunishModal(profile.id, profile.username);
      if (profile.is_banned) {
        banBtn.style.display = 'none';
        unbanBtn.style.display = 'inline-block';
      } else {
        banBtn.style.display = 'inline-block';
        unbanBtn.style.display = 'none';
        banBtn.onclick = () => openBanModal(profile.id, profile.username);
      }
    } else {
      modBar.style.display = 'none';
    }
  } else {
    modBar.style.display = 'none';
    document.getElementById('profileBioDisplay').textContent = 'Community Player';
  }

  let completionsCount = 0;
  let progressCount = 0;
  let verificationsCount = 0;
  let totalPoints = 0;

  let playerRecords = [];
  let playerVerifications = [];

  state.levels.forEach(lvl => {
    if (lvl.verifier.toLowerCase() === username.toLowerCase()) {
      verificationsCount++;
      const vPoints = calculatePoints(lvl.rank, 100) * 1.2;
      totalPoints += vPoints;
      playerVerifications.push({ level: lvl, points: vPoints });
    }

    const rec = (lvl.victors || []).find(v => v.player_name.toLowerCase() === username.toLowerCase());
    if (rec) {
      if (rec.percentage === 100) completionsCount++;
      else progressCount++;

      const rPoints = calculatePoints(lvl.rank, rec.percentage);
      totalPoints += rPoints;
      playerRecords.push({ level: lvl, record: rec, points: rPoints });
    }
  });

  document.getElementById('profileTotalPoints').textContent = `${totalPoints.toFixed(2)} pts`;
  document.getElementById('profileCompletions').textContent = completionsCount;
  document.getElementById('profileProgressions').textContent = progressCount;
  document.getElementById('profileVerifications').textContent = verificationsCount;

  sortRecords(playerRecords, state.profileSortMode);

  const completedList = document.getElementById('profileCompletedList');
  if (playerRecords.length === 0) {
    completedList.innerHTML = '<p class="text-muted" style="padding:10px;">No records recorded yet.</p>';
  } else {
    completedList.innerHTML = playerRecords.map(item => `
      <div class="profile-level-row">
        <div>
          <strong>#${item.level.rank} ${escapeHtml(item.level.name)}</strong>
          <span class="pct-badge ${item.record.percentage === 100 ? 'pct-100' : 'pct-partial'}">${item.record.percentage}%</span>
          <span class="text-muted" style="font-size:0.8rem; margin-left: 8px;">(${escapeHtml(item.record.device)})</span>
        </div>
        <div>
          <span style="color:var(--accent); font-weight:700; margin-right: 12px;">+${item.points.toFixed(2)} pts</span>
          <a href="${escapeHtml(item.record.proof_url)}" target="_blank" rel="noopener">Proof</a>
        </div>
      </div>
    `).join('');
  }

  const verifiedList = document.getElementById('profileVerifiedList');
  if (playerVerifications.length === 0) {
    verifiedList.innerHTML = '<p class="text-muted" style="padding:10px;">No verified levels.</p>';
  } else {
    verifiedList.innerHTML = playerVerifications.map(item => `
      <div class="profile-level-row">
        <div>
          <strong>#${item.level.rank} ${escapeHtml(item.level.name)}</strong>
          <span class="user-badge" style="margin-left: 8px;">VERIFIED</span>
        </div>
        <div>
          <span style="color:var(--success); font-weight:700; margin-right: 12px;">+${item.points.toFixed(2)} pts</span>
          <a href="${escapeHtml(item.level.video_url)}" target="_blank" rel="noopener">Proof</a>
        </div>
      </div>
    `).join('');
  }

  // PRIVATE SUBMISSIONS QUEUE (VISIBLE TO OWNER OR MOD)
  const submissionsCard = document.getElementById('userSubmissionsCard');
  if (isOwnProfile || isMod) {
    submissionsCard.style.display = 'block';
    loadUserPrivateSubmissions(username);
  } else {
    submissionsCard.style.display = 'none';
  }
}

async function loadUserPrivateSubmissions(username) {
  const container = document.getElementById('userSubmissionsList');
  const countBadge = document.getElementById('userPendingCountBadge');
  container.innerHTML = '<div class="loading">Loading your submission queue...</div>';

  const { data: allPending } = await supabaseClient
    .from('submissions')
    .select('id, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const globalPending = allPending || [];

  const { data: userSubs, error } = await supabaseClient
    .from('submissions')
    .select('*, levels(name, rank)')
    .eq('player_name', username)
    .order('created_at', { ascending: false });

  if (error) {
    container.innerHTML = `<div class="login-error">${error.message}</div>`;
    return;
  }

  const pendingSubs = (userSubs || []).filter(s => s.status === 'pending');
  countBadge.textContent = `${pendingSubs.length} / 3 Active on Hold`;

  if (!userSubs || userSubs.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding:10px;">No submissions sent yet.</p>';
    return;
  }

  container.innerHTML = '';
  userSubs.forEach(sub => {
    const row = document.createElement('div');
    row.className = 'profile-sub-item';

    const lvlName = sub.levels ? `#${sub.levels.rank} - ${sub.levels.name}` : `Level ID #${sub.level_id}`;
    let statusBadge = '';
    let queueInfo = '';

    if (sub.status === 'pending') {
      const queuePos = globalPending.findIndex(item => item.id === sub.id) + 1;
      statusBadge = '<span class="status-badge badge-pending">On Hold</span>';
      queueInfo = `<span class="queue-badge">Queue Position: #${queuePos > 0 ? queuePos : 1}</span>`;
    } else if (sub.status === 'accepted') {
      statusBadge = '<span class="status-badge badge-accepted">Accepted</span>';
    } else {
      statusBadge = '<span class="status-badge badge-rejected">Rejected</span>';
    }

    row.innerHTML = `
      <div class="sub-item-top">
        <div>
          <strong>${escapeHtml(lvlName)}</strong>
          <span class="pct-badge ${sub.percentage === 100 ? 'pct-100' : 'pct-partial'}">${sub.percentage}%</span>
          <span class="user-badge" style="margin-left: 6px;">[${sub.type.toUpperCase()}]</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${queueInfo}
          ${statusBadge}
        </div>
      </div>
      <div class="sub-item-bottom">
        <div>
          <span>Device: ${escapeHtml(sub.device)}</span> • 
          <a href="${escapeHtml(sub.proof_url)}" target="_blank" rel="noopener">Proof Video</a>
        </div>
        <span>Submitted ${new Date(sub.created_at).toLocaleDateString()}</span>
      </div>
      ${sub.status === 'rejected' && sub.rejection_reason ? `
        <div class="reason-box-rejected">
          <strong>Moderator Decision:</strong> ${escapeHtml(sub.rejection_reason)}
        </div>
      ` : ''}
    `;

    container.appendChild(row);
  });
}

function sortRecords(records, mode) {
  if (mode === 'rank') records.sort((a, b) => a.level.rank - b.level.rank);
  else if (mode === 'points') records.sort((a, b) => b.points - a.points);
  else if (mode === 'pct') records.sort((a, b) => b.record.percentage - a.record.percentage);
  else if (mode === 'name') records.sort((a, b) => a.level.name.localeCompare(b.level.name));
}

// ==========================================
// 10. LEADERBOARD RENDERING
// ==========================================
function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardBody');
  tbody.innerHTML = '';

  const scores = {};

  state.levels.forEach(lvl => {
    if (lvl.verifier) {
      const v = lvl.verifier;
      if (!scores[v]) scores[v] = { points: 0, completions: 0, progress: 0, verifications: 0 };
      scores[v].points += calculatePoints(lvl.rank, 100) * 1.2;
      scores[v].verifications++;
    }

    (lvl.victors || []).forEach(vic => {
      const p = vic.player_name;
      if (!scores[p]) scores[p] = { points: 0, completions: 0, progress: 0, verifications: 0 };
      if (vic.percentage === 100) scores[p].completions++;
      else scores[p].progress++;
      scores[p].points += calculatePoints(lvl.rank, vic.percentage);
    });
  });

  const sorted = Object.keys(scores)
    .map(name => ({ name, ...scores[name] }))
    .sort((a, b) => b.points - a.points);

  sorted.forEach((player, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${idx + 1}</strong></td>
      <td><a class="player-link" onclick="openProfile('${escapeHtml(player.name)}')">${escapeHtml(player.name)}</a></td>
      <td style="color:var(--accent); font-weight:700;">${player.points.toFixed(2)} pts</td>
      <td>${player.completions}</td>
      <td>${player.progress}</td>
      <td>${player.verifications}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// 11. ADMIN LEVEL & DIRECT RECORD FORMS
// ==========================================
function populateAdminDropdown() {
  const select = document.getElementById('victorLevelSelect');
  if (!select) return;
  select.innerHTML = '';
  state.levels.forEach(lvl => {
    const opt = document.createElement('option');
    opt.value = lvl.id;
    opt.textContent = `#${lvl.rank} - ${lvl.name}`;
    select.appendChild(opt);
  });
}

const addVictorForm = document.getElementById('addVictorForm');
if (addVictorForm) {
  addVictorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const levelId = parseInt(document.getElementById('victorLevelSelect').value, 10);
    const playerName = document.getElementById('victorPlayerName').value.trim();
    const pct = parseInt(document.getElementById('victorPercentage').value, 10);
    const proof = document.getElementById('victorProofUrl').value.trim();
    const device = document.getElementById('victorDevice').value.trim();

    const { error } = await supabaseClient.from('victors').insert([{
      level_id: levelId,
      player_name: playerName,
      percentage: pct,
      proof_url: proof,
      device: device
    }]);

    if (!error) {
      await logModeratorAction('DIRECT_ADD_VICTOR', playerName, `Placed ${pct}% on Level ID #${levelId}`);
      alert('Victor recorded successfully!');
      addVictorForm.reset();
      await loadLevels();
    } else {
      alert('Error: ' + error.message);
    }
  });
}

const addLevelForm = document.getElementById('addLevelForm');
if (addLevelForm) {
  addLevelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rank = parseInt(document.getElementById('levelRank').value, 10);
    const name = document.getElementById('levelName').value.trim();
    const length = document.getElementById('levelLength').value.trim();
    const minPct = parseInt(document.getElementById('levelMinPct').value, 10);
    const creator = document.getElementById('levelCreator').value.trim();
    const verifier = document.getElementById('levelVerifier').value.trim();
    const video = document.getElementById('levelVideo').value.trim();
    const desc = document.getElementById('levelDescription').value.trim();

    const { error } = await supabaseClient.from('levels').insert([{
      rank: rank,
      name: name,
      length: length,
      min_pct: minPct,
      creator: creator,
      verifier: verifier,
      video_url: video,
      description: desc
    }]);

    if (!error) {
      await logModeratorAction('ADD_LEVEL', name, `Placed #${rank} ${name} verified by ${verifier}`);
      alert(`Level #${rank} "${name}" published to ANL!`);
      addLevelForm.reset();
      await loadLevels();
    } else {
      alert('Error: ' + error.message);
    }
  });
}

// ==========================================
// 12. UTILITY & HELPER FUNCTIONS
// ==========================================
function calculatePoints(rank, percentage) {
  if (rank > 50) return 0;
  const base = 350.0 * Math.exp(-0.035 * (rank - 1));
  if (percentage === 100) return base;
  return base * (0.1 + 0.4 * (percentage / 100));
}

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

function filterLevels(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.level-item').forEach(item => {
    const match = item.textContent.toLowerCase().includes(q);
    item.style.display = match ? 'flex' : 'none';
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}