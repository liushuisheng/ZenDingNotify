const state = {
  overview: null,
  defects: [],
  logs: [],
  config: null,
  assignees: [],
  defectListMode: "all",
  ownerFilters: [],
  visibleDefects: [],
  selectedLogId: null,
  lastFetchAt: "",
  fetching: false,
  view: "overview",
  authenticated: false
};

const titles = {
  overview: ["总览", "当天缺陷处理情况与剩余风险"],
  defects: ["缺陷列表", "查看当前抓取到的缺陷快照"],
  logs: ["推送记录", "查看钉钉推送内容、结果和触发来源"],
  actions: ["手动推送", "手动触发日报与风险提醒"],
  settings: ["配置", "切换真实禅道数据、钉钉机器人和推送规则"]
};

const viewRoutes = {
  overview: "#/overview",
  defects: "#/defects",
  logs: "#/logs",
  actions: "#/actions",
  settings: "#/settings"
};

const guestPathParts = window.location.pathname.split("/").filter(Boolean);
const guestMode = guestPathParts[0] === "guest";
const guestOwner = guestMode && guestPathParts[1] ? decodeURIComponent(guestPathParts[1]) : "";
const guestViews = ["overview", "defects"];
const allowedViews = guestMode ? guestViews : Object.keys(titles);

const roleGroups = [
  {
    id: "frontend",
    name: "前端",
    members: [["刘水生"], ["谌祖恒"], ["王思鑫"], ["李彦龙"], ["李思成"], ["马陈绵"]]
  },
  {
    id: "backend",
    name: "后端",
    members: [["潘文豪"], ["陈运辉"], ["李世超"], ["彭求春"]]
  },
  {
    id: "warzone",
    name: "战区",
    members: [["陈加鹏"], ["蔡锐彬"], ["陈鑫海"], ["谢旻熹"], ["汉寻"]]
  }
];

const zentaoAccountAliases = {
  liuss: "刘水生",
  liushuisheng: "刘水生",
  lisicheng: "李思成",
  wangsixin: "王思鑫",
  liyanlong: "李彦龙",
  machm: "马陈绵",
  machenmian: "马陈绵",
  tanzuheng: "谌祖恒",
  chenzuheng: "谌祖恒",
  chenjiapeng: "陈加鹏",
  chenjp: "陈加鹏",
  panwenhao: "潘文豪",
  pwh: "潘文豪",
  chenyunhui: "陈运辉",
  chenyh: "陈运辉",
  lishichao: "李世超",
  lisc: "李世超",
  pengqiuchun: "彭求春",
  pengqc: "彭求春"
};

document.body.classList.toggle("guest-mode", guestMode);
document.body.classList.toggle("guest-owner-mode", hasGuestOwnerScope());
document.querySelectorAll(".nav-item").forEach((button) => {
  const view = button.dataset.view;
  const isAllowed = allowedViews.includes(view);
  button.classList.toggle("hidden", !isAllowed);
  button.disabled = !isAllowed;
  if (!isAllowed) return;
  button.addEventListener("click", () => {
    switchView(view, { updateRoute: view !== "defects" });
    if (view === "defects") {
      if (getViewFromRoute() !== "defects") resetDefectFiltersToDefault();
      renderDefects();
    }
  });
});
window.addEventListener("hashchange", handleRouteChange);
window.addEventListener("popstate", handleRouteChange);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLogModal();
});

function handleRouteChange() {
  switchView(getViewFromRoute(), { updateRoute: false });
  if (state.view === "defects") {
    applyDefectRouteParams();
    renderOwnerFilterOptions();
    renderDefects({ updateRoute: false });
  }
}

document.getElementById("refreshBtn").addEventListener("click", refreshFromZentao);
document.getElementById("priorityFilter").addEventListener("change", () => renderDefectsFromToolbar({ resetMode: true }));
document.getElementById("statusFilter").addEventListener("change", () => renderDefectsFromToolbar({ resetMode: true }));
document.getElementById("openedAgeFilter").addEventListener("change", () => renderDefectsFromToolbar({ resetMode: true }));
document.getElementById("defectSort").addEventListener("change", () => renderDefects());
document.getElementById("copyDefectsBtn").addEventListener("click", copyVisibleDefects);
document.getElementById("clearDefectCondition").addEventListener("click", clearDefectCondition);
document.getElementById("resetDefectFiltersBtn").addEventListener("click", resetNormalDefectFilters);
document.getElementById("closeLogModal").addEventListener("click", closeLogModal);
document.getElementById("logModal").addEventListener("click", (event) => {
  if (event.target.id === "logModal") closeLogModal();
});
document.getElementById("ownerFilterTrigger").addEventListener("click", () => {
  if (hasGuestOwnerScope()) return;
  document.getElementById("ownerMultiSelect").classList.toggle("open");
});
document.getElementById("configForm").addEventListener("submit", saveConfig);
document.getElementById("loginForm").addEventListener("submit", loginAdmin);
document.getElementById("logoutBtn").addEventListener("click", logoutAdmin);
document.getElementById("reloadConfigBtn").addEventListener("click", loadConfig);
document.getElementById("scheduleEnabled").addEventListener("change", toggleSchedulerEnabled);
document.getElementById("addP1P2Time").addEventListener("click", () => addP1P2TimeInput(""));
document.querySelectorAll("[data-time-target]").forEach((element) => {
  element.addEventListener("click", (event) => {
    if (event.target.closest("button, .switch-field")) return;
    openTimePicker(document.getElementById(element.dataset.timeTarget));
  });
});
document.querySelectorAll("[data-scheduler-rule]").forEach((input) => {
  input.addEventListener("change", toggleSchedulerRule);
});
document.addEventListener("click", (event) => {
  const ownerSelect = document.getElementById("ownerMultiSelect");
  if (!ownerSelect.contains(event.target)) ownerSelect.classList.remove("open");
});

document.querySelectorAll(".action-card").forEach((button) => {
  button.addEventListener("click", async () => {
    const result = document.getElementById("actionResult");
    result.classList.remove("hidden");
    result.textContent = "执行中...";
    try {
      const response = await fetch(button.dataset.action, { method: "POST" });
      const data = await response.json();
      result.textContent = JSON.stringify(data, null, 2);
      await loadAll();
    } catch (error) {
      result.textContent = error.message;
    }
  });
});

initApp();
setInterval(pollFetchStatus, 3000);

async function initApp() {
  if (guestMode) {
    showAppShell();
    switchView(getViewFromRoute(), { updateRoute: false });
    await loadAll();
    return;
  }

  try {
    const session = await getJson("/api/session");
    if (session.authenticated) {
      state.authenticated = true;
      showAppShell();
      switchView(getViewFromRoute(), { updateRoute: false });
      await loadAll();
      return;
    }
  } catch {
    // Fall through to the login screen when the session check fails.
  }

  showLoginScreen();
}

function showLoginScreen() {
  state.authenticated = false;
  document.body.classList.add("login-mode");
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("logoutBtn").classList.add("hidden");
  renderCurrentRole();
  document.getElementById("adminPassword").focus();
}

function showAppShell() {
  document.body.classList.remove("login-mode");
  document.getElementById("loginScreen").classList.add("hidden");
  renderCurrentRole();
}

function renderCurrentRole() {
  const roleText = document.getElementById("currentRoleText");
  const logoutButton = document.getElementById("logoutBtn");
  const isAdmin = !guestMode && state.authenticated;
  if (roleText) roleText.textContent = isAdmin ? "管理员登录" : (guestOwner ? `访客登录：${formatGuestOwnerDisplay(guestOwner)}` : "访客登录");
  if (logoutButton) logoutButton.classList.toggle("hidden", !isAdmin);
}

function formatGuestOwnerDisplay(value) {
  const normalized = normalizePersonName(value);
  return normalized || value;
}

function hasGuestOwnerScope() {
  return guestMode && Boolean(guestOwner);
}

async function loginAdmin(event) {
  event.preventDefault();
  const error = document.getElementById("loginError");
  const password = document.getElementById("adminPassword").value;
  error.classList.add("hidden");
  error.textContent = "";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || data.error || "登录失败");
    state.authenticated = true;
    document.getElementById("adminPassword").value = "";
    showAppShell();
    switchView(getViewFromRoute(), { updateRoute: false });
    await loadAll();
  } catch (loginError) {
    error.textContent = loginError.message;
    error.classList.remove("hidden");
  }
}

async function logoutAdmin() {
  await fetch("/api/logout", { method: "POST" });
  state.authenticated = false;
  state.config = null;
  showLoginScreen();
}

async function loadAll() {
  const [overview, defects, status, assignees, configData, logs] = await Promise.all([
    getJson(scopedApiUrl("/api/overview")),
    getJson(scopedApiUrl("/api/defects")),
    getJson("/api/config-status"),
    guestMode ? Promise.resolve({ assignees: [] }) : getJson("/api/assignees"),
    getJson(guestMode ? "/api/public-config" : "/api/config"),
    guestMode ? Promise.resolve({ logs: [] }) : getJson("/api/push-logs")
  ]);
  state.overview = overview;
  state.defects = defects.defects;
  state.logs = logs.logs;
  state.assignees = assignees.assignees || [];
  state.config = configData.config;
  renderStatus(status);
  renderOverview();
  applyDefectRouteParams();
  renderOwnerFilterOptions();
  renderDefects({ updateRoute: state.view === "defects", replaceRoute: true });
  if (!guestMode) {
    renderLogs();
    renderConfig();
  }
}

function scopedApiUrl(path) {
  if (!guestOwner) return path;
  const params = new URLSearchParams({ owner: guestOwner });
  return `${path}?${params.toString()}`;
}

async function refreshFromZentao() {
  setFetchButtonState(true);
  try {
    const response = await fetch("/api/actions/fetch", { method: "POST" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "抓取禅道数据失败");
    await loadAll();
    showToast(`已抓取 ${data.count} 条缺陷数据`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setFetchButtonState(false);
  }
}

async function pollFetchStatus() {
  if (document.body.classList.contains("login-mode")) return;
  try {
    const status = await getJson("/api/config-status");
    const wasFetching = state.fetching;
    renderStatus(status);
    if (wasFetching && !state.fetching) await loadAll();
  } catch {
    // The next poll will recover; keep the current UI state meanwhile.
  }
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

function getViewFromRoute() {
  const { view } = parseRoute();
  return view && titles[view] && allowedViews.includes(view) ? view : "overview";
}

function parseRoute() {
  const hash = window.location.hash || viewRoutes.overview;
  const [path, query = ""] = hash.split("?");
  const view = Object.entries(viewRoutes).find(([, route]) => route === path)?.[0] || "overview";
  return { view, path, params: new URLSearchParams(query) };
}

function switchView(view, options = {}) {
  if (!titles[view] || !allowedViews.includes(view)) view = "overview";
  state.view = view;
  document.querySelector(".main").classList.toggle("list-mode", ["defects", "logs"].includes(view));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((element) => element.classList.remove("active"));
  document.getElementById(`${view}View`).classList.add("active");
  document.getElementById("viewTitle").textContent = titles[view][0];
  document.getElementById("viewSubtitle").textContent = titles[view][1];

  const nextRoute = viewRoutes[view];
  if (options.updateRoute !== false && options.replaceRoute && window.location.hash !== nextRoute) {
    window.history.replaceState(null, "", nextRoute);
  } else if (options.updateRoute !== false && window.location.hash !== nextRoute) {
    window.location.hash = nextRoute;
  }
}

function renderStatus(status) {
  renderLastSyncTime(status.lastFetchAt);
  setFetchButtonState(Boolean(status.fetching));
  document.getElementById("configStatus").innerHTML = `
    <div class="status-row"><span>禅道抓取</span><strong>${status.zentaoEnabled ? "已启用" : "示例数据"}</strong></div>
    <div class="status-row"><span>钉钉推送</span><strong>${status.dingtalkDryRun ? "Dry-run" : "真实发送"}</strong></div>
    <div class="status-row"><span>定时任务</span><strong>${status.schedulerEnabled ? "已开启" : "已关闭"}</strong></div>
    <div class="status-row"><span>人员映射</span><strong>${status.mappedUsers} 人</strong></div>
  `;
}

function setFetchButtonState(fetching) {
  state.fetching = fetching;
  const button = document.getElementById("refreshBtn");
  if (!button) return;
  button.disabled = fetching;
  button.classList.toggle("loading", fetching);
  button.title = fetching ? "正在同步禅道数据..." : "同步更新";
  button.setAttribute("aria-label", fetching ? "正在同步禅道数据" : "同步更新");
}

function renderLastSyncTime(value) {
  if (value !== undefined) state.lastFetchAt = value || "";
  const element = document.getElementById("lastSyncText");
  if (!element) return;
  element.textContent = `最近更新：${formatCompactTime(state.lastFetchAt)}`;
}

function renderOverview() {
  const overview = state.overview;
  if (!overview) return;

  const metrics = getOverviewMetrics(overview);

  document.getElementById("metrics").innerHTML = metrics.map(([label, value, tone, mode]) => `
    <button class="metric ${tone}" type="button" data-defect-mode="${mode}" title="查看${label}缺陷">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
      <span class="metric-foot">${metricFoot(label)}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-defect-mode]").forEach((button) => {
    button.addEventListener("click", () => openDefectList(button.dataset.defectMode));
  });

  document.getElementById("urgentList").innerHTML = renderDefectCards(sortDefectsForDisplay(overview.urgentOpen), true);
  document.getElementById("normalList").innerHTML = renderDefectCards(sortDefectsForDisplay(overview.normalOpen), false);
  document.getElementById("urgentCount").textContent = overview.urgentOpen.length;
  document.getElementById("normalCount").textContent = overview.normalOpen.length;

  const ownerStatsPanel = document.querySelector(".owner-stats-panel");
  ownerStatsPanel?.classList.toggle("hidden", hasGuestOwnerScope());
  if (hasGuestOwnerScope()) return;

  document.getElementById("ownerTable").innerHTML = renderTable(
    ["负责人", "未处理缺陷", "P1/P2 未处理", "普通未处理", "待测试", "今日新增", "今日转出", "今日转入", "今日解决"],
    overview.owners.map((owner) => [
      owner.name,
      ownerStatButton(owner, "ownerOpen", getOwnerOpenTotal(owner)),
      ownerStatButton(owner, "ownerUrgent", owner.urgentOpen),
      ownerStatButton(owner, "ownerNormal", owner.normalOpen),
      ownerStatButton(owner, "ownerPendingTest", owner.pendingTest),
      ownerStatButton(owner, "ownerTodayAdded", owner.todayAdded),
      ownerStatButton(owner, "ownerTodayTransferred", owner.todayTransferred),
      ownerStatButton(owner, "ownerTodayReturned", owner.todayReturned),
      ownerStatButton(owner, "ownerTodayResolved", owner.todayResolved)
    ])
  );
  document.querySelectorAll("[data-owner-stat-mode]").forEach((button) => {
    button.addEventListener("click", () => openOwnerDefectList(button.dataset.ownerStatMode, button.dataset.owner));
  });
}

function getOverviewMetrics(overview) {
  if (hasGuestOwnerScope()) {
    const owner = overview.owners[0] || {};
    return [
      ["今日新增", owner.todayAdded || overview.stats.todayAdded || 0, "incoming", "todayAdded"],
      ["今日解决", owner.todayResolved || overview.stats.todayResolved || 0, "done", "todayResolved"],
      ["今日关闭", overview.stats.todayClosed || 0, "done", "todayClosed"],
      ["今日转出", owner.todayTransferred || 0, "incoming", "ownerTodayTransferred"],
      ["今日转入", owner.todayReturned || 0, "incoming", "ownerTodayReturned"],
      ["未完成总数", overview.stats.openTotal, "total", "open"],
      ["P1/P2 未完成", overview.stats.urgentOpen, "urgent", "urgent"],
      ["非 P1/P2 未完成", overview.stats.normalOpen, "normal", "normal"],
      ["已解决待验证", overview.stats.resolvedPendingVerify || 0, "done", "resolvedPendingVerify"],
      ["异常数据", overview.stats.abnormalOpen, "urgent", "abnormal"]
    ];
  }
  return [
    ["今日新增", overview.stats.todayAdded, "incoming", "todayAdded"],
    ["今日解决", overview.stats.todayResolved, "done", "todayResolved"],
    ["今日关闭", overview.stats.todayClosed, "done", "todayClosed"],
    ["异常数据", overview.stats.abnormalOpen, "urgent", "abnormal"],
    ["未完成总数", overview.stats.openTotal, "total", "open"],
    ["P1/P2 未完成", overview.stats.urgentOpen, "urgent", "urgent"],
    ["非 P1/P2 未完成", overview.stats.normalOpen, "normal", "normal"],
    ["已解决待验证", overview.stats.resolvedPendingVerify || 0, "done", "resolvedPendingVerify"]
  ];
}

function renderDefectCards(defects, urgent) {
  if (!defects.length) return `<div class="empty">暂无数据</div>`;
  return defects.map((defect) => {
    const ageLabel = getOpenedAgeLabel(defect.openedDate);
    return `
    <article class="defect-item ${urgent ? "urgent" : ""} ${isFatal(defect) ? "fatal" : ""} ${ageLabel === "超期" ? "overdue" : ""}">
      <div class="defect-title" title="#${escapeHtml(defect.id)} ${escapeHtml(defect.title)}">
        <span class="defect-id">#${escapeHtml(defect.id)}</span>
        <a class="defect-title-text" href="${escapeHtml(defect.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(defect.title)}</a>
      </div>
      <div class="meta">
        ${isFatal(defect) ? `<span class="pill fatal">致命</span>` : ""}
        ${renderNewPendingPill(defect)}
        ${isReactivatedByTestToFrontendDefect(defect) ? `<span class="pill reactivated">重新激活</span>` : ""}
        ${renderAgePill(defect, ageLabel)}
        <span class="pill ${urgent ? "urgent" : ""}">P${escapeHtml(defect.priority)}</span>
        <span class="meta-owner">负责人：${escapeHtml(defect.assignedTo || "未指派")}</span>
      </div>
    </article>
  `;
  }).join("");
}

function ownerStatButton(owner, mode, value) {
  const disabled = Number(value) <= 0;
  return `<button class="owner-stat-link" type="button" data-owner-stat-mode="${escapeHtml(mode)}" data-owner="${escapeHtml(owner.account)}" ${disabled ? "disabled" : ""} title="${disabled ? "暂无缺陷" : `查看${escapeHtml(owner.name)}的缺陷详情`}">${escapeHtml(value)}</button>`;
}

function getOwnerOpenTotal(owner) {
  return Number(owner.openTotal ?? (Number(owner.urgentOpen || 0) + Number(owner.normalOpen || 0)));
}

function renderDefects(options = {}) {
  const priority = document.getElementById("priorityFilter").value;
  const status = document.getElementById("statusFilter").value;
  const openedAge = document.getElementById("openedAgeFilter").value;
  const sort = document.getElementById("defectSort").value;
  let defects = sortDefectsForDisplay(state.defects);

  defects = defects.filter((defect) => isConfiguredPersonDefect(defect, state.defectListMode));
  if (priority === "urgent") defects = defects.filter((defect) => ["1", "2"].includes(String(defect.priority)));
  if (priority === "normal") defects = defects.filter((defect) => !["1", "2"].includes(String(defect.priority)));
  if (!hasGuestOwnerScope() && state.ownerFilters.length) defects = defects.filter((defect) => matchesOwnerFilters(defect, state.defectListMode));
  defects = applyDefectListMode(defects, state.defectListMode);
  defects = applyStatusFilter(defects, status);
  defects = applyOpenedAgeFilter(defects, openedAge);
  if (!["todayAdded", "resolvedPendingVerify", "ownerPendingTest", "ownerTodayAdded", "ownerTodayTransferred", "ownerTodayReturned"].includes(state.defectListMode)) {
    defects = defects.filter(isCurrentTerminalDefect);
  }
  defects = sortDefectsByMode(defects, sort, state.defectListMode);
  state.visibleDefects = defects;
  document.getElementById("defectsCount").textContent = defects.length;
  document.getElementById("defectsTable").classList.add("is-scrollable");
  renderDefectConditionBar();

  const modeDateColumn = getModeDateColumn(state.defectListMode, defects);
  const terminalDateColumn = modeDateColumn || getTerminalDateColumn(defects);
  const showResolverColumn = state.defectListMode !== "ownerTodayReturned" && shouldShowResolverColumn(defects, state.defectListMode);
  const showOwnerColumn = state.defectListMode !== "todayClosed";
  const showTransferToColumn = state.defectListMode === "ownerTodayTransferred";
  const showTransferFromColumn = state.defectListMode === "ownerTodayReturned";
  const showClosedByColumn = state.defectListMode === "todayClosed";
  const headers = ["ID", "标题", "优先级", "状态"];
  if (showOwnerColumn) headers.push("负责人");
  if (showTransferToColumn) headers.push("转入人");
  if (showTransferFromColumn) headers.push("转出人");
  if (showResolverColumn) headers.push("解决人");
  if (showClosedByColumn) headers.push("由谁关闭");
  if (terminalDateColumn) headers.push(terminalDateColumn);
  headers.push("创建时间");

  document.getElementById("defectsTable").innerHTML = renderTable(
    headers,
    defects.map((defect) => {
      const row = [
        `#${defect.id}`,
        titleLink(defect),
        badge(["1", "2"].includes(String(defect.priority)) ? "urgent" : "normal", `P${defect.priority}`),
        badge(statusBadgeTone(defect.status), statusText(defect.status))
      ];
      if (showOwnerColumn) row.push(ownerCell(defect, state.defectListMode));
      if (showTransferToColumn) row.push(titledText(formatPersonDisplayName(defect.assignedTo)));
      if (showTransferFromColumn) row.push(titledText(formatPersonDisplayName(defect.assignedFrom)));
      if (showResolverColumn) row.push(titledText(formatPersonDisplayName(getResolverNameForMode(defect, state.defectListMode))));
      if (showClosedByColumn) row.push(titledText(formatPersonDisplayName(defect.closedBy)));
      if (terminalDateColumn) row.push(formatTime(getModeDate(defect, state.defectListMode) || getTerminalDate(defect)));
      row.push(formatTime(defect.openedDate));
      return row;
    }),
    "defects-data-table"
  );

  if (state.view === "defects" && options.updateRoute !== false) {
    updateDefectRoute(Boolean(options.replaceRoute));
  }
}

function renderDefectsFromToolbar(options = {}) {
  if (options.resetMode) state.defectListMode = "all";
  renderDefects();
}

function resetDefectFiltersToDefault() {
  state.defectListMode = "all";
  state.ownerFilters = [];
  document.getElementById("priorityFilter").value = "all";
  document.getElementById("statusFilter").value = "active";
  document.getElementById("openedAgeFilter").value = "all";
  document.getElementById("defectSort").value = "priorityHigh";
  updateOwnerFilterLabel();
}

function clearDefectCondition() {
  resetDefectFiltersToDefault();
  renderOwnerFilterOptions();
  renderDefects();
}

function resetNormalDefectFilters() {
  resetDefectFiltersToDefault();
  renderOwnerFilterOptions();
  renderDefects();
}

function renderDefectConditionBar() {
  const bar = document.getElementById("defectConditionBar");
  const text = document.getElementById("defectConditionText");
  const toolbar = document.querySelector("#defectsView .toolbar");
  const isConditionMode = state.defectListMode && state.defectListMode !== "all";
  bar.classList.toggle("hidden", !isConditionMode);
  toolbar.classList.toggle("hidden", isConditionMode);
  if (isConditionMode) text.textContent = getDefectConditionText();
}

function getDefectConditionText() {
  const modeLabels = {
    todayAdded: "今日新增",
    todayResolved: "今日解决",
    todayClosed: "今日关闭",
    open: "未完成总数",
    urgent: "P1/P2 未完成",
    normal: "非 P1/P2 未完成",
    abnormal: "异常数据",
    resolvedPendingVerify: "已解决待验证",
    ownerOpen: "负责人统计 / 未处理缺陷",
    ownerUrgent: "负责人统计 / P1/P2 未处理",
    ownerNormal: "负责人统计 / 普通未处理",
    ownerPendingTest: "负责人统计 / 待测试",
    ownerTodayAdded: "负责人统计 / 今日新增",
    ownerTodayTransferred: "负责人统计 / 今日转出",
    ownerTodayReturned: "负责人统计 / 今日转入",
    ownerTodayResolved: "负责人统计 / 今日解决"
  };
  const ownerText = !hasGuestOwnerScope() && state.ownerFilters.length ? ` · ${state.ownerFilters.join("、")}` : "";
  return `当前条件：${modeLabels[state.defectListMode] || "自定义条件"}${ownerText}`;
}

function shouldShowResolverColumn(defects, mode) {
  if (mode === "abnormal") return true;
  if (!defects.length) return false;
  return defects.every((defect) => ["resolved", "closed"].includes(normalizeStatus(defect.status)));
}

function getResolverName(defect) {
  if (isLastTransferFromConfiguredOwnerToTest(defect)) return defect.assignedFrom;
  if (defect.resolvedBy && !isTestOwner(defect.resolvedBy)) return defect.resolvedBy;
  if (defect.assignedFrom && !isTestOwner(defect.assignedFrom)) return defect.assignedFrom;
  return defect.resolvedBy || "-";
}

function getResolverNameForMode(defect, mode) {
  if (mode === "abnormal") return defect.assignedFrom || defect.resolvedBy || "-";
  return getResolverName(defect);
}

function getDefectOwnerName(defect) {
  if (normalizeStatus(defect.status) === "closed") {
    return getFrontendDeveloperName(defect) || getResolverName(defect) || "未指派";
  }
  return defect.assignedTo || "未指派";
}

function getDefectOwnerNameForMode(defect, mode) {
  return getDefectOwnerName(defect);
}

function ownerCell(defect, mode) {
  const owner = formatPersonDisplayName(getDefectOwnerNameForMode(defect, mode));
  const note = getOwnerTransferNote(defect, mode);
  if (!note) return titledText(owner);
  const title = `${owner} ${note}`;
  return `
    <div class="owner-cell" title="${escapeHtml(title)}">
      <span class="ellipsis-cell">${escapeHtml(owner)}</span>
      <small>${escapeHtml(note)}</small>
    </div>
  `;
}

function getOwnerTransferNote(defect, mode) {
  if (mode !== "todayAdded") return "";
  if (!isTodayTransferredDefect(defect)) return "";
  if (!isFrontendOwner(defect.assignedFrom)) return "";
  return `【由${formatPersonDisplayName(defect.assignedFrom)}转入】`;
}

function getFrontendDeveloperName(defect) {
  const resolver = getResolverName(defect);
  if (isFrontendOwner(resolver)) return resolver;
  if (isFrontendOwner(defect.assignedFrom)) return defect.assignedFrom;
  return "";
}

function matchesOwnerFilters(defect, mode) {
  if (!state.ownerFilters.length) return true;
  return state.ownerFilters.some((owner) => getOwnerMatchFields(defect, mode).some((value) => namesMatch(value, owner)));
}

function getOwnerMatchFields(defect, mode) {
  if (mode === "ownerTodayAdded") return [getInitialAssignedTo(defect)];
  if (["ownerOpen", "ownerUrgent", "ownerNormal", "ownerTodayReturned"].includes(mode)) return [defect.assignedTo];
  if (["ownerPendingTest", "ownerTodayTransferred"].includes(mode)) return [defect.assignedFrom];
  if (mode === "ownerTodayResolved") return getDeveloperOwnerFields(defect);
  return [getDefectOwnerName(defect)];
}

function getDeveloperOwnerFields(defect) {
  return [getResolverName(defect), defect.assignedFrom].filter(Boolean);
}

function isConfiguredPersonDefect(defect, mode) {
  if (normalizeStatus(defect.status) === "active" && isTestOwner(defect.assignedTo) && !isAbnormalTransferredDefect(defect)) return false;
  const configured = state.config?.rules?.assignees || [];
  if (!configured.length) return true;
  if (mode === "ownerTodayTransferred" && isTodayTransferredDefect(defect)) {
    return configured.some((assignee) => namesMatch(defect.assignedFrom, assignee));
  }
  if (mode === "todayAdded" && isTodayTransferredDefect(defect)) {
    return configured.some((assignee) => namesMatch(defect.assignedFrom, assignee));
  }
  if (mode === "ownerTodayReturned" && isTodayReturnedDefect(defect)) {
    return configured.some((assignee) => namesMatch(defect.assignedTo, assignee));
  }
  if (mode === "ownerTodayAdded" && isTodayInitiallyAssignedDefect(defect)) {
    return configured.some((assignee) => namesMatch(getInitialAssignedTo(defect), assignee));
  }
  if (["resolved", "closed"].includes(normalizeStatus(defect.status))) {
    return configured.some((assignee) => [defect.resolvedBy, defect.assignedFrom, getInitialAssignedTo(defect)].some((value) => namesMatch(value, assignee)));
  }
  if (isTestOwner(defect.assignedTo)) {
    return configured.some((assignee) => namesMatch(defect.assignedFrom, assignee));
  }
  return configured.some((assignee) => namesMatch(defect.assignedTo, assignee));
}

function getTerminalDateColumn(defects) {
  if (!defects.length) return "";
  const statuses = new Set(defects.map((defect) => normalizeStatus(defect.status)));
  const terminalStatuses = [...statuses].filter((status) => ["resolved", "closed"].includes(status));
  if (!terminalStatuses.length || terminalStatuses.length !== statuses.size) return "";
  if (statuses.size === 1 && statuses.has("resolved")) return "解决时间";
  if (statuses.size === 1 && statuses.has("closed")) return "关闭时间";
  return "解决时间/关闭时间";
}

function getModeDateColumn(mode, defects) {
  if (!defects.length) return "";
  const map = {
    todayClosed: "关闭时间",
    resolvedPendingVerify: "解决时间",
    ownerTodayTransferred: "转出时间",
    ownerTodayReturned: "转入时间"
  };
  return map[mode] || "";
}

function getModeDate(defect, mode) {
  const map = {
    todayAdded: () => defect.openedDate,
    todayResolved: () => getDeveloperResolvedAt(defect) || getTerminalDate(defect),
    todayClosed: () => defect.closedDate,
    resolvedPendingVerify: () => getDeveloperResolvedAt(defect) || getTerminalDate(defect),
    ownerTodayAdded: () => defect.openedDate,
    ownerTodayTransferred: () => defect.assignedAt,
    ownerTodayReturned: () => defect.assignedAt,
    ownerTodayResolved: () => getDeveloperResolvedAt(defect) || getTerminalDate(defect)
  };
  return map[mode]?.() || "";
}

function getTerminalDate(defect) {
  const status = normalizeStatus(defect.status);
  if (status === "closed") return defect.closedDate || defect.resolvedDate || defect.assignedAt;
  if (status === "resolved") return defect.resolvedDate || defect.assignedAt || defect.closedDate;
  return "";
}

function isCurrentTerminalDefect(defect) {
  const status = normalizeStatus(defect.status);
  if (!["resolved", "closed"].includes(status)) return true;
  return isToday(getTerminalDate(defect));
}

function applyDefectRouteParams() {
  if (getViewFromRoute() !== "defects") return;
  const { params } = parseRoute();
  const mode = getValidParam(params.get("mode"), ["all", "todayAdded", "todayResolved", "todayClosed", "open", "urgent", "normal", "abnormal", "resolvedPendingVerify", "ownerOpen", "ownerUrgent", "ownerNormal", "ownerPendingTest", "ownerTodayAdded", "ownerTodayTransferred", "ownerTodayReturned", "ownerTodayResolved"], "all");
  const priority = getValidParam(params.get("priority"), ["all", "urgent", "normal"], "all");
  const status = getValidParam(params.get("status"), ["all", "active", "resolved", "closed"], "active");
  const openedAge = getValidParam(params.get("openedAge"), ["all", "today", "yesterday", "beforeYesterday", "overdue"], "all");
  const sort = getValidParam(params.get("sort"), ["priorityHigh", "priorityLow"], "priorityHigh");

  state.defectListMode = mode;
  document.getElementById("priorityFilter").value = priority;
  document.getElementById("statusFilter").value = status;
  document.getElementById("openedAgeFilter").value = openedAge;
  document.getElementById("defectSort").value = sort;
  state.ownerFilters = hasGuestOwnerScope() ? [] : splitRouteList(params.get("owners"));
}

function getValidParam(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function splitRouteList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function buildDefectRoute() {
  const params = new URLSearchParams();
  params.set("mode", state.defectListMode || "all");
  params.set("priority", document.getElementById("priorityFilter").value || "all");
  params.set("status", document.getElementById("statusFilter").value || "active");
  params.set("openedAge", document.getElementById("openedAgeFilter").value || "all");
  params.set("sort", document.getElementById("defectSort").value || "priorityHigh");
  if (!hasGuestOwnerScope() && state.ownerFilters.length) params.set("owners", state.ownerFilters.join(","));
  return `${viewRoutes.defects}?${params.toString()}`;
}

function updateDefectRoute(replace = false) {
  const nextRoute = buildDefectRoute();
  if (window.location.hash === nextRoute) return;
  if (replace) window.history.replaceState(null, "", nextRoute);
  else window.history.pushState(null, "", nextRoute);
}

async function copyVisibleDefects() {
  const defects = state.visibleDefects || [];
  if (!defects.length) {
    showToast("当前没有可复制的缺陷", "error");
    return;
  }

  const text = formatDefectsForCopy(defects);
  try {
    await copyText(text);
    showToast(`已复制 ${defects.length} 条缺陷`);
  } catch (error) {
    showToast(error.message || "复制失败", "error");
  }
}

function formatDefectsForCopy(defects) {
  return defects.map((defect) => [
    `缺陷ID：#${defect.id}`,
    `优先级：P${defect.priority}`,
    `标题：${defect.title}`,
    `访问链接：${defect.url || "-"}`
  ].join("\n")).join("\n\n");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("复制失败，请手动选择列表内容复制");
}

function renderOwnerFilterOptions() {
  const wrapper = document.getElementById("ownerMultiSelect");
  const menu = document.getElementById("ownerFilterMenu");
  wrapper.classList.toggle("hidden", hasGuestOwnerScope());
  if (hasGuestOwnerScope()) {
    state.ownerFilters = [];
    menu.innerHTML = "";
    updateOwnerFilterLabel();
    return;
  }
  const owners = getConfiguredOwnerOptions();
  state.ownerFilters = state.ownerFilters
    .map((owner) => owners.find((item) => namesMatch(item, owner)) || "")
    .filter(Boolean);
  const selected = new Set(state.ownerFilters);
  menu.innerHTML = `
    <div class="multi-select-actions">
      <button type="button" class="mini-button" id="ownerSelectAll">全选</button>
      <button type="button" class="mini-button" id="ownerClear">清空</button>
    </div>
    <div class="multi-select-options">
      ${owners.map((owner) => `
        <label class="multi-option">
          <input type="checkbox" value="${escapeHtml(owner)}" ${selected.has(owner) ? "checked" : ""}>
          <span>${escapeHtml(owner)}</span>
        </label>
      `).join("") || `<div class="picker-empty">暂无负责人</div>`}
    </div>
  `;
  menu.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      state.defectListMode = "all";
      state.ownerFilters = [...menu.querySelectorAll("input[type='checkbox']:checked")].map((item) => item.value);
      updateOwnerFilterLabel();
      renderDefects();
    });
  });
  document.getElementById("ownerSelectAll").addEventListener("click", () => {
    state.defectListMode = "all";
    state.ownerFilters = owners;
    renderOwnerFilterOptions();
    renderDefects();
  });
  document.getElementById("ownerClear").addEventListener("click", () => {
    state.defectListMode = "all";
    state.ownerFilters = [];
    renderOwnerFilterOptions();
    renderDefects();
  });
  updateOwnerFilterLabel();
}

function getConfiguredOwnerOptions() {
  const owners = state.config?.rules?.assignees?.length ? state.config.rules.assignees : state.assignees;
  const fallbackOwners = owners?.length ? owners : state.defects.map((defect) => getDefectOwnerName(defect));
  return [...new Set((fallbackOwners || []).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function updateOwnerFilterLabel() {
  const trigger = document.getElementById("ownerFilterTrigger");
  if (!state.ownerFilters.length) trigger.textContent = "全部负责人";
  else if (state.ownerFilters.length === 1) trigger.textContent = state.ownerFilters[0];
  else trigger.textContent = `已选 ${state.ownerFilters.length} 人`;
}

function openDefectList(mode) {
  state.defectListMode = mode;
  state.ownerFilters = [];
  updateOwnerFilterLabel();
  const priorityFilter = document.getElementById("priorityFilter");
  const statusFilter = document.getElementById("statusFilter");
  const openedAgeFilter = document.getElementById("openedAgeFilter");
  if (mode === "urgent") priorityFilter.value = "urgent";
  else if (mode === "normal") priorityFilter.value = "normal";
  else priorityFilter.value = "all";
  openedAgeFilter.value = "all";
  if (mode === "todayResolved") statusFilter.value = "all";
  else if (mode === "todayClosed") statusFilter.value = "closed";
  else if (mode === "resolvedPendingVerify") statusFilter.value = "resolved";
  else if (["open", "urgent", "normal", "abnormal"].includes(mode)) statusFilter.value = "active";
  else statusFilter.value = "all";
  switchView("defects", { updateRoute: false });
  renderDefects();
}

function openOwnerDefectList(mode, owner) {
  state.defectListMode = mode;
  state.ownerFilters = hasGuestOwnerScope() ? [] : (owner ? [owner] : []);
  updateOwnerFilterLabel();
  const priorityFilter = document.getElementById("priorityFilter");
  const statusFilter = document.getElementById("statusFilter");
  const openedAgeFilter = document.getElementById("openedAgeFilter");
  priorityFilter.value = "all";
  openedAgeFilter.value = "all";
  if (mode === "ownerPendingTest") statusFilter.value = "resolved";
  else statusFilter.value = ["ownerOpen", "ownerUrgent", "ownerNormal"].includes(mode) ? "active" : "all";
  switchView("defects", { updateRoute: false });
  renderDefects();
}

function applyStatusFilter(defects, status) {
  if (status === "all") return defects;
  if (status === "open") return defects.filter(isOpenDefect);
  return defects.filter((defect) => normalizeStatus(defect.status) === status);
}

function applyOpenedAgeFilter(defects, openedAge) {
  if (openedAge === "all") return defects;
  return defects.filter((defect) => getOpenedAgeBucket(defect.openedDate) === openedAge);
}

function applyDefectListMode(defects, mode) {
  if (mode === "todayAdded") return defects.filter((defect) => isToday(defect.openedDate));
  if (mode === "todayResolved") return defects.filter((defect) => isFrontendResolvedDefect(defect) && isToday(getDeveloperResolvedAt(defect)));
  if (mode === "todayClosed") return defects.filter((defect) => isFrontendClosedDefect(defect) && isToday(defect.closedDate));
  if (mode === "open") return defects.filter(isVisibleOpenDefect);
  if (mode === "urgent") return defects.filter((defect) => isVisibleOpenDefect(defect) && ["1", "2"].includes(String(defect.priority)));
  if (mode === "normal") return defects.filter((defect) => isVisibleOpenDefect(defect) && !["1", "2"].includes(String(defect.priority)));
  if (mode === "abnormal") return defects.filter(isAbnormalTransferredDefect);
  if (mode === "resolvedPendingVerify") return defects.filter(isResolvedPendingVerifyDefect);
  if (mode === "ownerOpen") return defects.filter(isOpenDefect);
  if (mode === "ownerUrgent") return defects.filter((defect) => isOpenDefect(defect) && ["1", "2"].includes(String(defect.priority)));
  if (mode === "ownerNormal") return defects.filter((defect) => isOpenDefect(defect) && !["1", "2"].includes(String(defect.priority)));
  if (mode === "ownerPendingTest") return defects.filter(isResolvedPendingVerifyDefect);
  if (mode === "ownerTodayAdded") return defects.filter((defect) => isToday(defect.openedDate));
  if (mode === "ownerTodayTransferred") return defects.filter(isTodayTransferredDefect);
  if (mode === "ownerTodayReturned") return defects.filter(isTodayReturnedDefect);
  if (mode === "ownerTodayResolved") return defects.filter((defect) => isFrontendResolvedDefect(defect) && isToday(getDeveloperResolvedAt(defect)));
  return defects;
}

function renderLogs() {
  const logs = getRecentPushLogs();
  if (!logs.length) {
    document.getElementById("logsTable").innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }

  document.getElementById("logsTable").innerHTML = `
    <div class="table-scroll is-scrollable">
      <table class="logs-data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>标题</th>
            <th>结果</th>
            <th>触发</th>
            <th>@ 人</th>
            <th>缺陷数</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map((log) => `
            <tr class="clickable-row ${log.id === state.selectedLogId ? "selected" : ""}" data-log-id="${escapeHtml(log.id)}">
              <td>${escapeHtml(formatTime(log.createdAt))}</td>
              <td>${escapeHtml(pushTypeText(log.type))}</td>
              <td>${escapeHtml(log.title)}</td>
              <td>${log.ok ? badge("success", log.dryRun ? "Dry-run 成功" : "成功") : badge("urgent", `失败：${log.error}`)}</td>
              <td>${escapeHtml(triggerText(log.trigger))}</td>
              <td>${escapeHtml((log.mobiles || []).join(", ") || "-")}</td>
              <td>${escapeHtml((log.defectIds || []).length)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll(".clickable-row").forEach((row) => {
    row.addEventListener("click", () => {
      const log = logs.find((item) => item.id === row.dataset.logId);
      if (log) openLogModal(log);
    });
  });
}

function openLogModal(log) {
  state.selectedLogId = log.id;
  document.querySelectorAll(".clickable-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.logId === log.id);
  });
  document.getElementById("logModalTitle").textContent = "推送内容";
  document.getElementById("logModalMeta").textContent = `${log.title || pushTypeText(log.type)} · ${formatTime(log.createdAt)}`;
  document.getElementById("logModalContent").innerHTML = renderMarkdown(log.text || "");
  document.getElementById("logModal").classList.remove("hidden");
}

function closeLogModal() {
  document.getElementById("logModal").classList.add("hidden");
}

function getRecentPushLogs() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return [...(state.logs || [])]
    .filter((log) => {
      const time = new Date(log.createdAt).getTime();
      return Number.isFinite(time) && time >= since;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

  lines.forEach((line) => {
    const text = line.trim();
    if (!text) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      return;
    }

    const heading = text.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      const level = Math.min(heading[1].length, 4);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const listItem = text.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      return;
    }

    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
    html.push(`<p>${renderInlineMarkdown(text)}</p>`);
  });

  if (listOpen) html.push("</ul>");
  return html.join("");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

async function loadConfig() {
  const data = await getJson("/api/config");
  state.config = data.config;
  renderConfig();
  renderOwnerFilterOptions();
  if (state.view === "defects") renderDefects({ replaceRoute: true });
}

function renderConfig() {
  const config = state.config;
  if (!config) return;
  document.getElementById("zentaoEnabled").checked = Boolean(config.zentao.enabled);
  document.getElementById("zentaoBaseUrl").value = config.zentao.baseUrl || "";
  document.getElementById("zentaoAccount").value = config.zentao.account || "";
  document.getElementById("zentaoPassword").value = config.zentao.password || "";
  document.getElementById("zentaoCookie").value = config.zentao.cookie || "";
  document.getElementById("zentaoProductIds").value = (config.zentao.productIds || []).join(",");
  document.getElementById("zentaoProjectId").value = config.zentao.projectId || 2635;
  document.getElementById("ruleStatuses").value = (config.rules.statuses || []).join(",");
  document.getElementById("rulePriorities").value = (config.rules.priorities || []).join(",");
  document.getElementById("ruleUrgentPriorities").value = (config.rules.urgentPriorities || []).join(",");
  renderAssigneePicker(config.rules.assignees || []);
  document.getElementById("dingDryRun").checked = config.dingtalk.dryRun !== false;
  document.getElementById("dingWebhook").value = config.dingtalk.webhook || config.dingtalk.accessToken || "";
  document.getElementById("dingSecret").value = config.dingtalk.secret || "";
  document.getElementById("scheduleEnabled").checked = config.scheduler?.enabled !== false;
  document.getElementById("scheduleYesterdayEnabled").checked = config.scheduler?.rules?.yesterday !== false;
  document.getElementById("scheduleP1P2Enabled").checked = config.scheduler?.rules?.p1p2 !== false;
  document.getElementById("scheduleFetchMinutes").value = config.scheduler?.fetchEveryMinutes || config.scheduler?.ruleFetchEveryMinutes || 5;
  document.getElementById("scheduleYesterdayTime").value = config.scheduler.yesterdayReportTime || "09:40";
  renderP1P2TimeInputs(config.scheduler.p1p2ReportTimes || [config.scheduler.p1p2ReportTime || "18:00"]);
  document.getElementById("userMappings").value = JSON.stringify(config.userMappings || {}, null, 2);
  document.getElementById("adminToken").value = config.auth?.adminToken || "";
}

function renderP1P2TimeInputs(times) {
  const list = document.getElementById("p1p2TimesList");
  list.innerHTML = "";
  const normalized = times?.length ? times : ["18:00"];
  normalized.forEach((time) => addP1P2TimeInput(time));
  refreshP1P2RemoveButtons();
}

function addP1P2TimeInput(value) {
  const list = document.getElementById("p1p2TimesList");
  const row = document.createElement("div");
  row.className = "time-item";
  row.innerHTML = `
    <input type="time" class="p1p2-time-input" value="${escapeHtml(value || "")}">
    <button type="button" class="mini-button remove-time-button">删除</button>
  `;
  row.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openTimePicker(row.querySelector(".p1p2-time-input"));
  });
  row.querySelector(".remove-time-button").addEventListener("click", (event) => {
    event.stopPropagation();
    row.remove();
    refreshP1P2RemoveButtons();
  });
  list.appendChild(row);
  refreshP1P2RemoveButtons();
}

function openTimePicker(input) {
  if (!input) return;
  input.focus();
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch {
      // Some browsers only allow showPicker directly during trusted click events.
    }
  }
}

function refreshP1P2RemoveButtons() {
  const rows = [...document.querySelectorAll("#p1p2TimesList .time-item")];
  rows.forEach((row) => {
    const button = row.querySelector(".remove-time-button");
    if (button) button.hidden = rows.length <= 1;
  });
}

function getP1P2ReportTimesFromForm() {
  const values = [...document.querySelectorAll(".p1p2-time-input")].map((input) => input.value).filter(Boolean);
  return [...new Set(values)].sort();
}

async function toggleSchedulerEnabled(event) {
  const checkbox = event.target;
  const enabled = checkbox.checked;
  checkbox.disabled = true;
  try {
    const response = await fetch("/api/scheduler/enabled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "定时任务开关保存失败");
    state.config.scheduler = data.scheduler;
    renderStatus({
      zentaoEnabled: Boolean(state.config.zentao.enabled),
      dingtalkDryRun: Boolean(state.config.dingtalk.dryRun),
      schedulerEnabled: data.scheduler.enabled !== false,
      mappedUsers: Object.keys(state.config.userMappings || {}).length
    });
    showToast(enabled ? "定时任务已开启" : "定时任务已关闭");
  } catch (error) {
    checkbox.checked = !enabled;
    document.getElementById("configResult").textContent = error.message;
    showToast(error.message, "error");
  } finally {
    checkbox.disabled = false;
  }
}

async function toggleSchedulerRule(event) {
  const checkbox = event.target;
  const rule = checkbox.dataset.schedulerRule;
  const enabled = checkbox.checked;
  const label = schedulerRuleName(rule);
  checkbox.disabled = true;
  try {
    const response = await fetch("/api/scheduler/rule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule, enabled })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "推送规则开关保存失败");
    state.config.scheduler = data.scheduler;
    showToast(`${label}已${enabled ? "开启" : "关闭"}`);
  } catch (error) {
    checkbox.checked = !enabled;
    document.getElementById("configResult").textContent = error.message;
    showToast(error.message, "error");
  } finally {
    checkbox.disabled = false;
  }
}

async function saveConfig(event) {
  event.preventDefault();
  const result = document.getElementById("configResult");
  result.classList.add("hidden");
  result.textContent = "";
  showToast("配置保存中...");

  let userMappings;
  try {
    userMappings = JSON.parse(document.getElementById("userMappings").value || "{}");
  } catch {
    showToast("人员映射 JSON 格式不正确，请检查后再保存。", "error");
    return;
  }

  const config = {
    zentao: {
      enabled: document.getElementById("zentaoEnabled").checked,
      baseUrl: document.getElementById("zentaoBaseUrl").value,
      account: document.getElementById("zentaoAccount").value,
      password: document.getElementById("zentaoPassword").value,
      cookie: document.getElementById("zentaoCookie").value,
      projectId: Number(document.getElementById("zentaoProjectId").value) || 2635,
      productIds: splitList(document.getElementById("zentaoProductIds").value).map(Number).filter(Number.isFinite)
    },
    rules: {
      statuses: splitList(document.getElementById("ruleStatuses").value),
      priorities: splitList(document.getElementById("rulePriorities").value),
      urgentPriorities: splitList(document.getElementById("ruleUrgentPriorities").value),
      assignees: getSelectedAssignees()
    },
    dingtalk: {
      dryRun: document.getElementById("dingDryRun").checked,
      webhook: document.getElementById("dingWebhook").value,
      secret: document.getElementById("dingSecret").value
    },
    scheduler: {
      enabled: document.getElementById("scheduleEnabled").checked,
      fetchEveryMinutes: Number(document.getElementById("scheduleFetchMinutes").value) || 5,
      yesterdayReportTime: document.getElementById("scheduleYesterdayTime").value || "09:40",
      p1p2ReportTimes: getP1P2ReportTimesFromForm(),
      rules: {
        yesterday: document.getElementById("scheduleYesterdayEnabled").checked,
        p1p2: document.getElementById("scheduleP1P2Enabled").checked
      }
    },
    userMappings,
    auth: {
      adminToken: document.getElementById("adminToken").value
    }
  };
  const assigneesChanged = !areAssigneeListsEqual(state.config?.rules?.assignees, config.rules.assignees);

  const response = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    showToast(data.error || "保存失败", "error");
    return;
  }

  state.config = data.config;
  renderConfig();
  if (assigneesChanged) {
    showToast("配置已保存，正在同步禅道数据...", "success", { duration: 0, loading: true });
    const syncResponse = await fetch("/api/actions/fetch", { method: "POST" });
    const syncData = await syncResponse.json();
    if (!syncResponse.ok || !syncData.ok) {
      await loadAll();
      showToast(syncData.error || "配置已保存，但同步数据失败", "error");
      return;
    }
    await loadAll();
    showToast(`配置已保存并同步 ${syncData.count} 条缺陷数据`);
    return;
  }
  await loadAll();
  showToast("配置已保存并生效");
}

function renderTable(headers, rows, className = "") {
  if (!rows.length) return `<div class="empty">暂无数据</div>`;
  const columnClasses = headers.map(getColumnClass);
  return `
    <table class="${escapeHtml(className)}">
      <thead>
        <tr>${headers.map((header, index) => `<th class="${columnClasses[index]}">${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell, index) => `<td class="${columnClasses[index]}">${renderCell(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

function getColumnClass(header) {
  if (["负责人", "解决人"].includes(header)) return "col-person";
  if (["创建时间", "解决时间", "关闭时间", "解决时间/关闭时间", "转入时间", "转出时间"].includes(header)) return "col-time";
  return "";
}

function renderAssigneePicker(selectedAssignees) {
  const picker = document.getElementById("assigneePicker");
  const selected = new Set((selectedAssignees || []).map((item) => String(item)));
  const assignees = state.assignees.length
    ? state.assignees
    : [...new Set(state.defects.map((defect) => defect.assignedTo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));

  if (!assignees.length) {
    picker.innerHTML = `<div class="picker-empty">暂无负责人数据，请先抓取缺陷。</div>`;
    return;
  }

  picker.innerHTML = `
    <div class="role-group-list">
      ${roleGroups.map((role) => `
        <label class="role-option">
          <input type="checkbox" name="assigneeRole" value="${role.id}">
          <span>
            <strong>${escapeHtml(role.name)}</strong>
            <small>${escapeHtml(role.members.map((aliases) => aliases[0]).join("、"))}</small>
          </span>
        </label>
      `).join("")}
    </div>
    <div class="picker-tools">
      <button type="button" class="mini-button" id="selectAllAssignees">全选</button>
      <button type="button" class="mini-button" id="clearAssignees">清空</button>
      <span>未勾选任何人时表示全部</span>
    </div>
    <div class="checkbox-list">
      ${assignees.map((assignee) => `
        <label class="check-option">
          <input type="checkbox" name="ruleAssignee" value="${escapeHtml(assignee)}" ${selected.has(assignee) ? "checked" : ""}>
          <span>${escapeHtml(assignee)}</span>
        </label>
      `).join("")}
    </div>
  `;

  document.getElementById("selectAllAssignees").addEventListener("click", () => {
    picker.querySelectorAll("input[name='ruleAssignee']").forEach((input) => {
      input.checked = true;
    });
    refreshRoleStates();
  });
  document.getElementById("clearAssignees").addEventListener("click", () => {
    picker.querySelectorAll("input[name='ruleAssignee']").forEach((input) => {
      input.checked = false;
    });
    refreshRoleStates();
  });
  picker.querySelectorAll("input[name='assigneeRole']").forEach((input) => {
    input.addEventListener("change", () => {
      setRoleMembersChecked(input.value, input.checked);
      refreshRoleStates();
    });
  });
  picker.querySelectorAll("input[name='ruleAssignee']").forEach((input) => {
    input.addEventListener("change", refreshRoleStates);
  });
  refreshRoleStates();
}

function getSelectedAssignees() {
  return [...document.querySelectorAll("input[name='ruleAssignee']:checked")].map((input) => input.value);
}

function setRoleMembersChecked(roleId, checked) {
  const role = roleGroups.find((item) => item.id === roleId);
  if (!role) return;
  const matched = getRoleMatchedAssignees(role);
  document.querySelectorAll("input[name='ruleAssignee']").forEach((input) => {
    if (matched.includes(input.value)) input.checked = checked;
  });
}

function refreshRoleStates() {
  document.querySelectorAll("input[name='assigneeRole']").forEach((input) => {
    const role = roleGroups.find((item) => item.id === input.value);
    const matched = role ? getRoleMatchedAssignees(role) : [];
    const personInputs = [...document.querySelectorAll("input[name='ruleAssignee']")];
    const checkedCount = matched.filter((assignee) => {
      const box = personInputs.find((item) => item.value === assignee);
      return box?.checked;
    }).length;
    input.checked = matched.length > 0 && checkedCount === matched.length;
    input.indeterminate = checkedCount > 0 && checkedCount < matched.length;
  });
}

function getRoleMatchedAssignees(role) {
  return state.assignees.filter((assignee) => role.members.some((aliases) => aliases.some((alias) => namesMatch(assignee, alias))));
}

function namesMatch(assignee, alias) {
  const person = normalizePersonName(assignee);
  const target = normalizePersonName(alias);
  return person === target;
}

function normalizePersonName(value) {
  const normalized = String(value || "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\([^)]*\)/g, "")
    .replace(/_[a-z0-9]+/gi, "")
    .trim()
    .toLowerCase();
  return zentaoAccountAliases[normalized] || normalized;
}

function formatPersonDisplayName(value) {
  const name = String(value || "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\([^)]*\)/g, "")
    .replace(/_[a-z0-9]+/gi, "")
    .trim();
  return name || "-";
}

function renderCell(value) {
  const text = String(value ?? "");
  if (text.startsWith("<span class=\"table-badge") || text.startsWith("<span class=\"ellipsis-cell") || text.startsWith("<a class=\"ellipsis-cell")) return text;
  if (text.trim().startsWith("<div class=\"owner-cell")) return text;
  if (text.startsWith("<button class=\"owner-stat-link")) return text;
  return escapeHtml(text);
}

function badge(tone, text) {
  return `<span class="table-badge ${tone}">${escapeHtml(text)}</span>`;
}

function statusBadgeTone(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "active") return "urgent";
  if (normalized === "resolved") return "success";
  if (normalized === "closed") return "closed";
  return "neutral";
}

function titledText(text) {
  return `<span class="ellipsis-cell" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}

function titleLink(defect) {
  return `<a class="ellipsis-cell title-link" href="${escapeHtml(defect.url || "#")}" target="_blank" rel="noreferrer" title="${escapeHtml(defect.title)}">${escapeHtml(defect.title)}</a>`;
}

function pushTypeText(type) {
  const map = {
    RULE_DEFECT_NOTIFY: "规则缺陷推送",
    YESTERDAY_DAILY_REPORT: "昨日日报",
    TODAY_P1P2_RISK_REPORT: "P1/P2 风险提醒",
    OVERDUE_DEFECT_REPORT: "超期缺陷单"
  };
  return map[type] || type || "-";
}

function triggerText(trigger) {
  const map = {
    manual: "手动",
    schedule: "定时"
  };
  return map[trigger] || trigger || "-";
}

function schedulerRuleName(rule) {
  const map = {
    yesterday: "昨日日报",
    p1p2: "P1/P2 风险提醒"
  };
  return map[rule] || "推送规则";
}

function sortDefectsForDisplay(defects) {
  return [...defects].sort((a, b) => {
    const testOwnerDiff = Number(isTestOwner(a.assignedTo)) - Number(isTestOwner(b.assignedTo));
    if (testOwnerDiff) return testOwnerDiff;
    const fatalDiff = Number(isFatal(b)) - Number(isFatal(a));
    if (fatalDiff) return fatalDiff;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function sortDefectsByMode(defects, sort, listMode) {
  if (isTimeDescListMode(listMode)) return sortDefectsByDateDesc(defects, (defect) => getModeDate(defect, listMode));
  if (sort === "priorityLow") return sortDefectsByPriority(defects, -1);
  return sortDefectsByPriority(defects, 1);
}

function isTimeDescListMode(mode) {
  return [
    "todayAdded",
    "todayResolved",
    "todayClosed",
    "resolvedPendingVerify",
    "ownerTodayAdded",
    "ownerTodayTransferred",
    "ownerTodayReturned",
    "ownerTodayResolved"
  ].includes(mode);
}

function sortDefectsByDateDesc(defects, getDate) {
  return [...defects].sort((a, b) => {
    const timeDiff = dateSortValue(getDate(b)) - dateSortValue(getDate(a));
    if (timeDiff) return timeDiff;
    const priorityDiff = priorityValue(a.priority) - priorityValue(b.priority);
    if (priorityDiff) return priorityDiff;
    const fatalDiff = Number(isFatal(b)) - Number(isFatal(a));
    if (fatalDiff) return fatalDiff;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function dateSortValue(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortDefectsByPriority(defects, direction) {
  return [...defects].sort((a, b) => {
    const statusDiff = statusSortValue(a.status) - statusSortValue(b.status);
    if (statusDiff) return statusDiff;
    const priorityDiff = (priorityValue(a.priority) - priorityValue(b.priority)) * direction;
    if (priorityDiff) return priorityDiff;
    const fatalDiff = Number(isFatal(b)) - Number(isFatal(a));
    if (fatalDiff) return fatalDiff;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function statusSortValue(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "active") return 0;
  if (normalized === "closed") return 2;
  return 1;
}

function priorityValue(priority) {
  const order = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    0: 5
  };
  const key = String(priority);
  return order[key] || 99;
}

function isFatal(defect) {
  return String(defect.severity || "").includes("致命") || String(defect.severity || "") === "1";
}

function statusText(status) {
  const normalized = normalizeStatus(status);
  const map = {
    active: "激活",
    resolved: "已解决",
    closed: "已关闭",
    changing: "变更中"
  };
  return map[normalized] || status || "-";
}

function normalizeStatus(status) {
  const text = String(status || "").trim();
  if (!text) return "";
  if (text.includes("已解决") || text.includes("解决") || /\bresolved\b/i.test(text)) return "resolved";
  if (text.includes("已关闭") || text.includes("关闭") || /\bclosed\b/i.test(text)) return "closed";
  if (text.includes("激活") || /\bactive\b/i.test(text)) return "active";
  if (text.includes("变更") || /\bchanging\b/i.test(text)) return "changing";
  return text;
}

function isOpenDefect(defect) {
  return !["resolved", "closed"].includes(normalizeStatus(defect.status));
}

function isVisibleOpenDefect(defect) {
  return isOpenDefect(defect) && !isTestOwner(defect.assignedTo);
}

function metricFoot(label) {
  const foots = {
    今日新增: "新进入缺陷池",
    今日解决: "开发已解决",
    今日关闭: "测试已关闭",
    今日转出: "转给测试或他人",
    今日转入: "从他人转入",
    异常数据: "需求需确认或重激活",
    未完成总数: "当前待处理",
    "P1/P2 未完成": "高优先级风险",
    "非 P1/P2 未完成": "普通待处理",
    已解决待验证: "等待测试验证"
  };
  return foots[label] || "";
}

function splitList(value) {
  return String(value || "").split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
}

function areAssigneeListsEqual(left, right) {
  const normalize = (values) => (values || []).map(normalizePersonName).filter(Boolean).sort();
  const leftValues = normalize(left);
  const rightValues = normalize(right);
  return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatCompactTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function isNewPendingDefect(defect) {
  return isWithinRecentHours(defect.openedDate, 4) || isRecentlyTransferredInDefect(defect);
}

function renderNewPendingPill(defect) {
  if (!isNewPendingDefect(defect)) return "";
  return `<span class="pill new" title="${escapeHtml(getPendingTimeTooltip(defect))}">新</span>`;
}

function renderAgePill(defect, ageLabel) {
  if (!ageLabel) return "";
  const className = `pill age ${ageLabel === "超期" ? "overdue" : ""}`.trim();
  const title = ageLabel === "超期" ? ` title="${escapeHtml(getPendingTimeTooltip(defect))}"` : "";
  return `<span class="${className}"${title}>${ageLabel}</span>`;
}

function getPendingTimeTooltip(defect) {
  const isTransferredIn = isRecentlyTransferredInDefect(defect);
  const label = isTransferredIn ? "转入时间" : "创建时间";
  const value = isTransferredIn ? defect.assignedAt : defect.openedDate;
  return `${label}：${formatTime(value)}`;
}

function isRecentlyTransferredInDefect(defect) {
  return (
    Boolean(defect.assignedFrom)
    && Boolean(defect.assignedTo)
    && !namesMatch(defect.assignedFrom, defect.assignedTo)
    && isWithinRecentHours(defect.assignedAt, 4)
  );
}

function isWithinRecentHours(value, hours) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const diff = Date.now() - date.getTime();
  return diff >= 0 && diff <= hours * 60 * 60 * 1000;
}

function normalizeDateMinute(value) {
  return String(value || "").trim().slice(0, 16);
}

function getOpenedAgeLabel(value) {
  const bucket = getOpenedAgeBucket(value);
  if (bucket === "yesterday") return "昨天";
  if (bucket === "beforeYesterday") return "前天";
  if (bucket === "overdue") return "超期";
  return "";
}

function getOpenedAgeBucket(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = startOfLocalDay(new Date());
  const openedDay = startOfLocalDay(date);
  const diffDays = Math.floor((today.getTime() - openedDay.getTime()) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays === 2) return "beforeYesterday";
  return "overdue";
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isPendingTestDefect(defect) {
  return normalizeStatus(defect.status) === "active" && isTestOwner(defect.assignedTo) && Boolean(defect.assignedFrom);
}

function isTodayTransferredDefect(defect) {
  return Boolean(defect.assignedFrom)
    && Boolean(defect.assignedTo)
    && !namesMatch(defect.assignedFrom, defect.assignedTo)
    && isToday(defect.assignedAt)
    && (!isTestOwner(defect.assignedTo) || !isResolvedByTransferAction(defect));
}

function isResolvedByTransferAction(defect) {
  if (normalizeStatus(defect.assignedStatusAfter) === "resolved") return true;
  return Boolean(defect.resolvedDate)
    && normalizeDateMinute(defect.resolvedDate) === normalizeDateMinute(defect.assignedAt)
    && namesMatch(defect.resolvedBy, defect.assignedFrom);
}

function isTodayReturnedDefect(defect) {
  return Boolean(defect.assignedFrom)
    && Boolean(defect.assignedTo)
    && !namesMatch(defect.assignedFrom, defect.assignedTo)
    && isToday(defect.assignedAt);
}

function isTodayInitiallyAssignedDefect(defect) {
  return Boolean(getInitialAssignedTo(defect)) && isToday(defect.openedDate);
}

function getInitialAssignedTo(defect) {
  return defect.initialAssignedTo || defect.assignedTo || "";
}

function isAbnormalTransferredDefect(defect) {
  return (isPendingTestDefect(defect) && isFrontendOwner(defect.assignedFrom))
    || isReactivatedByTestToFrontendDefect(defect);
}

function isReactivatedByTestToFrontendDefect(defect) {
  return normalizeStatus(defect.status) === "active"
    && isFrontendOwner(defect.assignedTo)
    && isTestOwner(defect.activatedBy);
}

function isFrontendResolvedDefect(defect) {
  return ["resolved", "closed"].includes(normalizeStatus(defect.status))
    && isResolvedByConfiguredOwnerToTest(defect);
}

function isResolvedByConfiguredOwnerToTest(defect) {
  return isTransferredToTest(defect) && [defect.assignedFrom, defect.resolvedBy].some(isFrontendOwner);
}

function isTransferredToTest(defect) {
  return isTestOwner(defect.assignedTo) || isTestOwner(defect.closedBy);
}

function isLastTransferFromConfiguredOwnerToTest(defect) {
  return isTransferredToTest(defect) && isFrontendOwner(defect.assignedFrom);
}

function isResolvedPendingVerifyDefect(defect) {
  return normalizeStatus(defect.status) === "resolved"
    && isTestOwner(defect.assignedTo)
    && isConfiguredDeveloperRelatedDefect(defect);
}

function isFrontendClosedDefect(defect) {
  return normalizeStatus(defect.status) === "closed"
    && isConfiguredDeveloperRelatedDefect(defect);
}

function isConfiguredDeveloperRelatedDefect(defect) {
  return [defect.assignedFrom, defect.resolvedBy, getInitialAssignedTo(defect)].some(isFrontendOwner);
}

function getDeveloperResolvedAt(defect) {
  return defect.resolvedDate || defect.assignedAt || "";
}

function isFrontendOwner(value) {
  const configured = (state.config?.rules?.assignees || []).filter((owner) => !isTestOwner(owner));
  return configured.some((owner) => namesMatch(value, owner));
}

function isTestOwner(value) {
  return ["陈加鹏", "陈家鹏"].some((name) => namesMatch(value, name));
}

let toastTimer;
function showToast(message, type = "success", options = {}) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.innerHTML = options.loading
    ? `<span class="toast-sync-icon" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`
    : escapeHtml(message);
  toast.className = `toast show ${type === "error" ? "error" : ""} ${options.loading ? "loading" : ""}`.trim();
  if (options.duration === 0) return;
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, options.duration || 1800);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
