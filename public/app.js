const state = {
  overview: null,
  defects: [],
  logs: [],
  accessLogs: [],
  operationLogs: [],
  syncLogs: [],
  config: null,
  assignees: [],
  defectListMode: "all",
  ownerFilters: [],
  visibleDefects: [],
  selectedLogId: null,
  lastFetchAt: "",
  fetching: false,
  loadingOverview: false,
  view: "overview",
  ownerScope: "",
  pinnedOverviewDefects: new Set(),
  requirementOverviewDefects: new Set(),
  overviewDefectDifficulties: {},
  activeDifficultyMenu: null,
  guestKnownDefectIds: null,
  notificationOwnerScope: "",
  guestNotificationTestShown: false,
  titleScrollTimer: null,
  originalTitle: document.title,
  activeGuestNotificationCount: 0,
  authenticated: false,
  accessVisit: null,
  accessAwayTimer: null,
  mobilePendingPanel: "urgent",
  mobileOwnerMetric: "open",
  mobileLogLimits: {
    logs: 10,
    accessLogs: 10,
    operationLogs: 10,
    syncLogs: 10
  }
};

const mobileLogObservers = new Map();
const mobileLogBatchSize = 10;

const difficultyOptions = [
  { value: "simple", label: "简单" },
  { value: "medium", label: "中度" },
  { value: "hard", label: "困难" }
];

const titles = {
  overview: ["总览", "当天缺陷处理情况与剩余风险"],
  defects: ["缺陷列表", "查看当前抓取到的缺陷快照"],
  logs: ["推送记录", "查看钉钉推送内容、结果和触发来源"],
  accessLogs: ["访问日志", "查看总览和个人视角访问记录"],
  operationLogs: ["操作日志", "查看个人访客的页面操作记录"],
  syncLogs: ["同步记录", "查看禅道数据同步时间、结果和数据变化"],
  actions: ["手动推送", "手动触发日报与风险提醒"],
  settings: ["配置", "切换真实禅道数据、钉钉机器人和推送规则"]
};

const viewRoutes = {
  overview: "#/overview",
  defects: "#/defects",
  logs: "#/logs",
  accessLogs: "#/access-logs",
  operationLogs: "#/operation-logs",
  syncLogs: "#/sync-logs",
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
document.body.classList.toggle("guest-owner-mode", hasOwnerScope());
document.querySelectorAll(".nav-item").forEach((button) => {
  const view = button.dataset.view;
  const isAllowed = allowedViews.includes(view);
  button.classList.toggle("hidden", !isAllowed);
  button.disabled = !isAllowed;
  if (!isAllowed) return;
  button.addEventListener("click", () => {
    switchView(view, { updateRoute: view !== "defects" });
    logGuestOperation("切换页面", titles[view]?.[0] || view);
    if (view === "defects") {
      if (getViewFromRoute() !== "defects") resetDefectFiltersToDefault();
      renderDefects();
    }
    closeMobileMenu();
  });
});
window.addEventListener("hashchange", handleRouteChange);
window.addEventListener("popstate", handleRouteChange);
window.addEventListener("beforeunload", () => sendAccessVisitDuration({ beacon: true, ended: true }));
window.addEventListener("pagehide", () => sendAccessVisitDuration({ beacon: true, ended: true }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") scheduleAccessAwayReport();
  else if (document.visibilityState === "visible") {
    clearAccessAwayReport();
    sendAccessVisitDuration();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMobileMenu();
    closeConfirmModal(false);
    closeLogModal();
  }
});

document.getElementById("mobileMenuBtn")?.addEventListener("click", openMobileMenu);
document.getElementById("mobileMenuFab")?.addEventListener("click", openMobileMenu);
document.getElementById("mobileMenuCloseBtn")?.addEventListener("click", closeMobileMenu);
document.getElementById("mobileMenuBackdrop")?.addEventListener("click", closeMobileMenu);
document.getElementById("mobileFilterToggle")?.addEventListener("click", toggleMobileDefectFilters);
document.getElementById("mobileFilterDone")?.addEventListener("click", closeMobileDefectFilters);
document.getElementById("mobileLogBackTop")?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});
window.addEventListener("scroll", updateMobileLogBackTop, { passive: true });
window.addEventListener("resize", updateMobileLogBackTop);
initMobileDefectSelects();
document.querySelectorAll("[data-mobile-pending]").forEach((button) => {
  button.addEventListener("click", () => setMobilePendingPanel(button.dataset.mobilePending));
});
document.querySelectorAll("[data-mobile-overview-more]").forEach((button) => {
  button.addEventListener("click", () => openDefectList(button.dataset.mobileOverviewMore));
});

function openMobileMenu() {
  document.body.classList.add("mobile-menu-open");
  document.getElementById("mobileMenuBtn")?.setAttribute("aria-expanded", "true");
  document.getElementById("mobileMenuFab")?.setAttribute("aria-expanded", "true");
}

function closeMobileMenu() {
  document.body.classList.remove("mobile-menu-open");
  document.getElementById("mobileMenuBtn")?.setAttribute("aria-expanded", "false");
  document.getElementById("mobileMenuFab")?.setAttribute("aria-expanded", "false");
}

function toggleMobileDefectFilters() {
  const toolbar = document.getElementById("defectToolbar");
  const button = document.getElementById("mobileFilterToggle");
  const open = !toolbar?.classList.contains("mobile-open");
  toolbar?.classList.toggle("mobile-open", open);
  button?.setAttribute("aria-expanded", String(open));
}

function closeMobileDefectFilters() {
  document.getElementById("defectToolbar")?.classList.remove("mobile-open");
  document.getElementById("mobileFilterToggle")?.setAttribute("aria-expanded", "false");
  closeMobileDefectSelects();
}

function initMobileDefectSelects() {
  ["priorityFilter", "defectSort", "statusFilter", "openedAgeFilter"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select || select.nextElementSibling?.classList.contains("mobile-select")) return;

    const mobileSelect = document.createElement("div");
    mobileSelect.className = "mobile-select";
    mobileSelect.dataset.selectId = id;
    mobileSelect.innerHTML = `
      <button type="button" class="mobile-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span></span><i aria-hidden="true"></i>
      </button>
      <div class="mobile-select-menu" role="listbox">
        ${Array.from(select.options).map((option) => `
          <button type="button" role="option" data-value="${escapeHtml(option.value)}">
            <span>${escapeHtml(option.textContent)}</span><i aria-hidden="true"></i>
          </button>
        `).join("")}
      </div>
    `;
    select.insertAdjacentElement("afterend", mobileSelect);

    mobileSelect.querySelector(".mobile-select-trigger").addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = !mobileSelect.classList.contains("open");
      closeMobileDefectSelects(mobileSelect);
      mobileSelect.classList.toggle("open", willOpen);
      mobileSelect.querySelector(".mobile-select-trigger").setAttribute("aria-expanded", String(willOpen));
    });
    mobileSelect.querySelectorAll("[data-value]").forEach((optionButton) => {
      optionButton.addEventListener("click", (event) => {
        event.stopPropagation();
        select.value = optionButton.dataset.value;
        syncMobileDefectSelect(select);
        closeMobileDefectSelects();
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    syncMobileDefectSelect(select);
  });
}

function syncMobileDefectSelect(select) {
  const mobileSelect = select?.nextElementSibling;
  if (!mobileSelect?.classList.contains("mobile-select")) return;
  const selectedOption = select.options[select.selectedIndex];
  const triggerLabel = mobileSelect.querySelector(".mobile-select-trigger span");
  if (triggerLabel) triggerLabel.textContent = selectedOption?.textContent || "请选择";
  mobileSelect.querySelectorAll("[data-value]").forEach((button) => {
    const selected = button.dataset.value === select.value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

function syncMobileDefectSelects() {
  document.querySelectorAll("#defectToolbar select").forEach(syncMobileDefectSelect);
}

function closeMobileDefectSelects(except = null) {
  document.querySelectorAll("#defectToolbar .mobile-select.open").forEach((mobileSelect) => {
    if (mobileSelect === except) return;
    mobileSelect.classList.remove("open");
    mobileSelect.querySelector(".mobile-select-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function updateMobileLogBackTop() {
  const button = document.getElementById("mobileLogBackTop");
  if (!button) return;
  const visible = window.matchMedia("(max-width: 760px)").matches
    && !document.body.classList.contains("login-mode")
    && document.documentElement.scrollHeight > window.innerHeight
    && window.scrollY >= window.innerHeight;
  button.classList.toggle("visible", visible);
}

function setMobilePendingPanel(panel) {
  state.mobilePendingPanel = panel === "normal" ? "normal" : "urgent";
  document.querySelectorAll("[data-mobile-pending]").forEach((button) => {
    const active = button.dataset.mobilePending === state.mobilePendingPanel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-pending-panel]").forEach((element) => {
    element.classList.toggle("mobile-active", element.dataset.pendingPanel === state.mobilePendingPanel);
  });
}

async function handleRouteChange() {
  const route = parseRoute();
  const previousOwnerScope = state.ownerScope;
  state.ownerScope = route.owner || "";
  updateOwnerScopeUi();
  switchView(getViewFromRoute(), { updateRoute: false });
  if (previousOwnerScope !== state.ownerScope && state.authenticated) {
    try {
      await loadAll();
    } catch (error) {
      showToast(error.message || "人员视角加载失败", "error");
    }
    return;
  }
  if (state.view === "defects") {
    applyDefectRouteParams();
    renderOwnerFilterOptions();
    renderDefects({ updateRoute: false });
  }
}

document.getElementById("refreshBtn").addEventListener("click", refreshFromZentao);
document.getElementById("mobileRefreshBtn")?.addEventListener("click", refreshFromZentao);
document.getElementById("priorityFilter").addEventListener("change", (event) => {
  logGuestOperation("筛选优先级", getSelectedText(event.target));
  renderDefectsFromToolbar({ resetMode: true });
});
document.getElementById("statusFilter").addEventListener("change", (event) => {
  logGuestOperation("筛选状态", getSelectedText(event.target));
  renderDefectsFromToolbar({ resetMode: true });
});
document.getElementById("openedAgeFilter").addEventListener("change", (event) => {
  logGuestOperation("筛选创建时间", getSelectedText(event.target));
  renderDefectsFromToolbar({ resetMode: true });
});
document.getElementById("defectSort").addEventListener("change", (event) => {
  logGuestOperation("调整排序", getSelectedText(event.target));
  renderDefects();
});
document.getElementById("copyDefectsBtn").addEventListener("click", copyVisibleDefects);
document.getElementById("clearDefectCondition").addEventListener("click", clearDefectCondition);
document.getElementById("resetDefectFiltersBtn").addEventListener("click", resetNormalDefectFilters);
document.getElementById("closeLogModal").addEventListener("click", closeLogModal);
document.getElementById("logModal").addEventListener("click", (event) => {
  if (event.target.id === "logModal") closeLogModal();
});
document.getElementById("confirmModal").addEventListener("click", (event) => {
  if (event.target.id === "confirmModal") closeConfirmModal(false);
});
document.getElementById("cancelConfirmModal").addEventListener("click", () => closeConfirmModal(false));
document.getElementById("confirmConfirmModal").addEventListener("click", () => closeConfirmModal(true));
document.getElementById("ownerFilterTrigger").addEventListener("click", () => {
  if (hasOwnerScope()) return;
  document.getElementById("ownerMultiSelect").classList.toggle("open");
});
document.getElementById("configForm").addEventListener("submit", saveConfig);
document.getElementById("loginForm").addEventListener("submit", loginAdmin);
document.getElementById("logoutBtn").addEventListener("click", logoutAdmin);
document.getElementById("brandHomeBtn").addEventListener("click", navigateHomeFromBrand);
document.getElementById("reloadConfigBtn").addEventListener("click", loadConfig);
document.getElementById("resetGuestPasswordBtn").addEventListener("click", resetGuestPassword);
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
  if (!event.target.closest(".mobile-select")) closeMobileDefectSelects();
  const ownerSelect = document.getElementById("ownerMultiSelect");
  if (!ownerSelect.contains(event.target)) ownerSelect.classList.remove("open");
  const scopeBadge = document.getElementById("ownerScopeBadge");
  if (scopeBadge && !scopeBadge.contains(event.target)) scopeBadge.classList.remove("open");
  const guestPasswordSelect = document.getElementById("guestPasswordOwnerSelect");
  if (guestPasswordSelect && !guestPasswordSelect.contains(event.target)) closeGuestPasswordOwnerSelect(guestPasswordSelect);
});

document.querySelectorAll(".action-card").forEach((button) => {
  button.addEventListener("click", async () => {
    const result = document.getElementById("actionResult");
    result.classList.remove("hidden");
    result.textContent = "执行中...";
    setDynamicRegionLoading(result, true);
    try {
      const response = await fetch(button.dataset.action, { method: "POST" });
      const data = await response.json();
      result.textContent = JSON.stringify(data, null, 2);
      await loadAll();
    } catch (error) {
      result.textContent = error.message;
    } finally {
      setDynamicRegionLoading(result, false);
    }
  });
});

initGlobalTooltips();
initApp();
setInterval(pollFetchStatus, 3000);

function initGlobalTooltips() {
  const tooltip = document.createElement("div");
  tooltip.className = "global-tooltip";
  document.body.appendChild(tooltip);
  let activeTarget = null;
  const mobileViewport = window.matchMedia("(max-width: 760px)");

  const isTitleTooltipTarget = (target) => Boolean(target.closest?.(".defect-title-text, .title-link"));
  const getTooltipTarget = (target) => {
    const tooltipTarget = target?.closest?.("[data-tooltip], [title]");
    if (mobileViewport.matches) {
      if (tooltipTarget?.getAttribute("title") && !tooltipTarget.dataset.tooltip) {
        tooltipTarget.dataset.tooltip = tooltipTarget.getAttribute("title");
      }
      tooltipTarget?.removeAttribute("title");
      return null;
    }
    return tooltipTarget;
  };
  const normalizeTooltipTarget = (target) => {
    if (!target) return "";
    if (!target.dataset.tooltip && target.getAttribute("title")) {
      target.dataset.tooltip = target.getAttribute("title");
      target.removeAttribute("title");
    }
    return target.dataset.tooltip || "";
  };
  const show = (target) => {
    if (mobileViewport.matches) return;
    const text = normalizeTooltipTarget(target);
    if (!text) return;
    if (isTitleTooltipTarget(target) && !isTextTruncated(target)) return;
    activeTarget = target;
    tooltip.textContent = text;
    tooltip.classList.toggle("title-tooltip", isTitleTooltipTarget(target));
    tooltip.classList.add("show");
    positionGlobalTooltip(tooltip, target);
  };
  const hide = (target) => {
    if (target && activeTarget !== target) return;
    activeTarget = null;
    tooltip.classList.remove("show");
  };

  document.addEventListener("mouseover", (event) => {
    const target = getTooltipTarget(event.target);
    if (!target || target.contains(event.relatedTarget)) return;
    show(target);
  });
  document.addEventListener("mouseout", (event) => {
    const target = getTooltipTarget(event.target);
    if (!target || target.contains(event.relatedTarget)) return;
    hide(target);
  });
  document.addEventListener("focusin", (event) => show(getTooltipTarget(event.target)));
  document.addEventListener("focusout", (event) => hide(getTooltipTarget(event.target)));
  window.addEventListener("scroll", () => activeTarget && positionGlobalTooltip(tooltip, activeTarget), true);
  window.addEventListener("resize", () => {
    if (mobileViewport.matches) hide();
    else if (activeTarget) positionGlobalTooltip(tooltip, activeTarget);
  });
}

function positionGlobalTooltip(tooltip, target) {
  const rect = target.getBoundingClientRect();
  const gap = 8;
  const tooltipRect = tooltip.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - tooltipRect.width / 2),
    window.innerWidth - tooltipRect.width - 8
  );
  const top = rect.top - tooltipRect.height - gap;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
  tooltip.classList.toggle("below", top < 8);
  if (top < 8) tooltip.style.top = `${rect.bottom + gap}px`;
}

function isTextTruncated(element) {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
}

async function initApp() {
  if (guestMode) {
    if (guestOwner) {
      try {
        const session = await getJson(`/api/guest-session?owner=${encodeURIComponent(guestOwner)}`);
        if (!session.authenticated) {
          showGuestLoginScreen(session);
          return;
        }
      } catch (error) {
        showGuestError(error.message || "访客地址不可用");
        return;
      }
    }
    showAppShell();
    switchView(getViewFromRoute(), { updateRoute: false });
    startAccessVisitTracking();
    try {
      await loadAll();
    } catch (error) {
      showGuestError(error.message || "访客地址不可用");
    }
    return;
  }

  try {
    const session = await getJson("/api/session");
    if (session.authenticated) {
      state.authenticated = true;
      showAppShell();
      state.ownerScope = parseRoute().owner || "";
      updateOwnerScopeUi();
      switchView(getViewFromRoute(), { updateRoute: false });
      try {
        await loadAll();
      } catch (error) {
        renderCurrentRole();
        renderLastSyncTime();
        showToast(error.message || "数据加载失败，已保留上一次数据", "error");
      }
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

function showGuestLoginScreen(session) {
  const loginScreen = document.getElementById("loginScreen");
  const ownerName = formatGuestOwnerDisplay(session.owner || guestOwner);
  const initialized = Boolean(session.initialized);
  state.authenticated = false;
  document.body.classList.add("login-mode");
  loginScreen.classList.remove("hidden");
  loginScreen.innerHTML = `
    <form class="login-panel" id="guestLoginForm">
      <div class="brand login-brand">
        <div class="brand-mark">ZD</div>
        <div>
          <strong>${initialized ? "访客访问" : "初始化访客密码"}</strong>
          <span>${escapeHtml(ownerName)} 的个人视角</span>
        </div>
      </div>
      <label class="field">
        <span>${initialized ? "访问密码" : "设置访问密码"}</span>
        <input id="guestPassword" type="password" autocomplete="${initialized ? "current-password" : "new-password"}" autofocus>
      </label>
      ${initialized ? "" : `
      <label class="field">
        <span>确认访问密码</span>
        <input id="guestPasswordConfirm" type="password" autocomplete="new-password">
      </label>`}
      <button type="submit" class="primary">${initialized ? "进入个人视角" : "设置并进入"}</button>
      <div id="guestLoginError" class="form-feedback hidden" role="alert"></div>
      <a class="secondary guest-error-link" href="/guest">返回访客总览</a>
    </form>
  `;
  document.getElementById("guestLoginForm").addEventListener("submit", loginGuestOwner);
  document.getElementById("guestPassword").focus();
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
  if (roleText) {
    if (isAdmin) roleText.textContent = "管理员";
    else roleText.textContent = guestOwner ? `访客登录：${formatGuestOwnerDisplay(guestOwner)}` : "访客登录";
  }
  if (logoutButton) logoutButton.classList.toggle("hidden", !isAdmin);
}

function formatGuestOwnerDisplay(value) {
  const normalized = normalizePersonName(value);
  return normalized || value;
}

function hasGuestOwnerScope() {
  return guestMode && Boolean(guestOwner);
}

function hasOwnerScope() {
  return Boolean(getActiveOwnerScope());
}

function canOperateOverviewDefectCards() {
  return !guestMode || hasGuestOwnerScope();
}

function getActiveOwnerScope() {
  return guestOwner || state.ownerScope || "";
}

function updateOwnerScopeUi() {
  document.body.classList.toggle("guest-owner-mode", hasOwnerScope());
  renderCurrentRole();
  renderOwnerScopeBadge();
}

function renderOwnerScopeBadge() {
  const badge = document.getElementById("ownerScopeBadge");
  if (!badge) return;
  const isAdmin = !guestMode && state.authenticated;
  const isScopedView = ["overview", "defects"].includes(state.view);
  const activeOwner = getActiveOwnerScope();
  const shouldShow = (isAdmin && (Boolean(state.ownerScope) ? isScopedView : state.view === "overview"))
    || (guestMode && isScopedView);
  badge.classList.toggle("hidden", !shouldShow);
  badge.classList.toggle("icon-only", shouldShow && !activeOwner);
  badge.classList.remove("open");
  if (!shouldShow) {
    badge.innerHTML = "";
    return;
  }

  const currentName = formatGuestOwnerDisplay(activeOwner);
  const options = getOwnerScopeSwitchOptions();
  badge.innerHTML = `
    ${activeOwner ? `<span class="owner-scope-text">当前视角：${escapeHtml(currentName)}</span>` : ""}
    <button class="owner-scope-switch" type="button" title="切换人员视角" aria-label="切换人员视角">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17 1l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 23l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    </button>
    <div class="owner-scope-menu">
      ${options.map((option) => `
        <button type="button" class="owner-scope-option ${option.account === activeOwner ? "active" : ""}" data-owner-scope="${escapeHtml(option.account)}">
          ${escapeHtml(option.name)}
        </button>
      `).join("")}
    </div>
  `;
  badge.querySelector(".owner-scope-switch")?.addEventListener("click", (event) => {
    event.stopPropagation();
    badge.classList.toggle("open");
  });
  badge.querySelectorAll("[data-owner-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextOwner = button.dataset.ownerScope;
      if (!nextOwner || nextOwner === activeOwner) {
        badge.classList.remove("open");
        return;
      }
      if (guestMode) {
        window.location.href = `/guest/${encodeURIComponent(nextOwner)}${state.view === "defects" ? "#/defects" : ""}`;
        return;
      }
      window.location.hash = `#/${encodeURIComponent(nextOwner)}/${state.view || "overview"}`;
    });
  });
}

function getOwnerScopeSwitchOptions() {
  const configured = state.config?.rules?.assignees || [];
  const fallbackOwners = state.overview?.owners?.map((owner) => owner.name || owner.account).filter(Boolean) || [];
  const owners = configured.length ? configured : fallbackOwners;
  const guestAccessAccounts = new Set(state.config?.guestAccessAccounts || []);
  return owners
    .map((name) => ({ name, account: getGuestAccountAlias(name) }))
    .filter((option) => !namesMatch(option.name, "陈加鹏") && !["chenjp", "chenjiapeng"].includes(option.account))
    .filter((option) => option.account)
    .filter((option) => !guestMode || guestAccessAccounts.has(option.account))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

async function loginGuestOwner(event) {
  event.preventDefault();
  const error = document.getElementById("guestLoginError");
  const password = document.getElementById("guestPassword").value;
  const confirmInput = document.getElementById("guestPasswordConfirm");
  error.classList.add("hidden");
  error.textContent = "";
  if (confirmInput && password !== confirmInput.value) {
    error.textContent = "两次输入的访问密码不一致";
    error.classList.remove("hidden");
    return;
  }

  try {
    const response = await fetch("/api/guest-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: guestOwner, password })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || data.error || "访客登录失败");
    document.getElementById("guestPassword").value = "";
    if (confirmInput) confirmInput.value = "";
    showAppShell();
    switchView(getViewFromRoute(), { updateRoute: false });
    startAccessVisitTracking();
    await loadAll();
  } catch (loginError) {
    error.textContent = loginError.message;
    error.classList.remove("hidden");
  }
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
    state.ownerScope = parseRoute().owner || "";
    updateOwnerScopeUi();
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

async function navigateHomeFromBrand() {
  if (guestMode) {
    window.location.href = "/guest";
    return;
  }
  const hadOwnerScope = Boolean(state.ownerScope);
  state.ownerScope = "";
  updateOwnerScopeUi();
  switchView("overview", { replaceRoute: true });
  if (!state.authenticated) return;
  if (hadOwnerScope) {
    try {
      await loadAll();
    } catch (error) {
      showToast(error.message || "首页加载失败", "error");
    }
  } else if (state.overview) {
    renderOverview();
  }
}

async function loadAll(options = {}) {
  setDynamicDataLoading(true);
  try {
    return await loadAllData(options);
  } finally {
    setDynamicDataLoading(false);
  }
}

async function loadAllData(options = {}) {
  const shouldShowLoading = !state.overview || options.forceLoading;
  if (shouldShowLoading) {
    state.loadingOverview = true;
    renderOverviewLoading();
  }
  const results = await Promise.allSettled([
    getJson(scopedApiUrl("/api/overview")),
    getJson(scopedApiUrl("/api/defects")),
    getJson("/api/config-status"),
    guestMode ? Promise.resolve({ assignees: [] }) : getJson("/api/assignees"),
    getJson(guestMode ? "/api/public-config" : "/api/config"),
    guestMode ? Promise.resolve({ logs: [] }) : getJson("/api/push-logs"),
    guestMode ? Promise.resolve({ logs: [] }) : getJson("/api/access-logs"),
    guestMode ? Promise.resolve({ logs: [] }) : getJson("/api/operation-logs"),
    guestMode ? Promise.resolve({ logs: [] }) : getJson("/api/sync-logs"),
    getJson("/api/overview-pins"),
    getJson("/api/overview-requirements"),
    getJson("/api/overview-difficulties")
  ]);
  state.loadingOverview = false;

  const overview = pickSettledResult(results[0], state.overview, "总览数据加载失败");
  const defects = pickSettledResult(results[1], state.defects.length ? { defects: state.defects } : null, "缺陷数据加载失败");
  if (!overview || !defects) {
    state.loadingOverview = false;
    throw new Error("数据加载失败，暂无可用的上一次同步数据");
  }

  const status = pickSettledResult(results[2], getFallbackConfigStatus());
  const assignees = pickSettledResult(results[3], { assignees: state.assignees || [] });
  const configData = pickSettledResult(results[4], { config: state.config });
  const logs = pickSettledResult(results[5], { logs: state.logs || [] });
  const accessLogs = pickSettledResult(results[6], { logs: state.accessLogs || [] });
  const operationLogs = pickSettledResult(results[7], { logs: state.operationLogs || [] });
  const syncLogs = pickSettledResult(results[8], { logs: state.syncLogs || [] });
  const overviewPins = pickSettledResult(results[9], { pinned: [...state.pinnedOverviewDefects] });
  const overviewRequirements = pickSettledResult(results[10], { requirements: [...state.requirementOverviewDefects] });
  const overviewDifficulties = pickSettledResult(results[11], { difficulties: state.overviewDefectDifficulties || {} });

  state.overview = overview;
  state.defects = defects.defects;
  state.pinnedOverviewDefects = new Set((overviewPins.pinned || []).map((id) => String(id)));
  state.requirementOverviewDefects = new Set((overviewRequirements.requirements || []).map((id) => String(id)));
  state.overviewDefectDifficulties = normalizeOverviewDifficulties(overviewDifficulties.difficulties);
  await notifyGuestOwnerNewDefects(defects.defects, Boolean(options.notifyGuestNewDefects));
  state.logs = logs.logs;
  state.accessLogs = accessLogs.logs;
  state.operationLogs = operationLogs.logs;
  state.syncLogs = syncLogs.logs;
  state.assignees = assignees.assignees || [];
  state.config = configData.config || state.config;
  renderOwnerScopeBadge();
  renderStatus(status);
  renderOverview();
  applyDefectRouteParams();
  renderOwnerFilterOptions();
  renderDefects({ updateRoute: state.view === "defects", replaceRoute: true });
  if (!guestMode) {
    renderLogs();
    renderAccessLogs();
    renderOperationLogs();
    renderSyncLogs();
    if (state.config) renderConfig();
  }
  maybeShowGuestNotificationTest();
}

function getDynamicDataRegions() {
  return [
    "#configStatus",
    "#lastSyncText",
    "#mobileLastSyncText",
    "#metrics",
    "#urgentCount",
    "#normalCount",
    "#mobileUrgentCount",
    "#mobileNormalCount",
    "#defectsCount",
    "#urgentList",
    "#normalList",
    "#ownerTable",
    "#mobileOwnerComparison",
    "#defectsTable",
    "#logsTable",
    "#accessLogsTable",
    "#operationLogsTable",
    "#syncLogsTable",
    "#settingsView .form-panel"
  ].flatMap((selector) => Array.from(document.querySelectorAll(selector)));
}

function setDynamicDataLoading(loading) {
  getDynamicDataRegions().forEach((element) => setDynamicRegionLoading(element, loading));
}

function setDynamicRegionLoading(element, loading) {
  if (!element) return;
  element.classList.add("dynamic-data-region");
  if (loading) {
    window.clearTimeout(element._dynamicDataTransitionTimer);
    element.classList.remove("dynamic-data-loaded", "dynamic-data-settling");
    element.classList.add("dynamic-data-loading");
    const needsEmptySkeleton = element.matches("#defectsTable, #logsTable, #accessLogsTable, #operationLogsTable, #syncLogsTable");
    element.classList.toggle("dynamic-data-empty", needsEmptySkeleton && !element.textContent.trim());
    element.setAttribute("aria-busy", "true");
    return;
  }
  const wasLoading = element.classList.contains("dynamic-data-loading");
  element.removeAttribute("aria-busy");
  if (!wasLoading) return;
  element.classList.remove("dynamic-data-loading", "dynamic-data-empty");
  element.classList.add("dynamic-data-settling", "dynamic-data-loaded");
  element._dynamicDataTransitionTimer = window.setTimeout(() => {
    element.classList.remove("dynamic-data-settling", "dynamic-data-loaded");
    delete element._dynamicDataTransitionTimer;
  }, 360);
}

function startAccessVisitTracking() {
  if (!guestMode || state.accessVisit) return;
  state.accessVisit = {
    sessionId: createClientSessionId(),
    startedAt: Date.now(),
    timer: window.setInterval(() => sendAccessVisitDuration(), 5000)
  };
  sendAccessVisitDuration();
}

function scheduleAccessAwayReport() {
  clearAccessAwayReport();
  state.accessAwayTimer = window.setTimeout(() => {
    state.accessAwayTimer = null;
    if (document.visibilityState === "hidden") {
      sendAccessVisitDuration({ beacon: true, away: true });
    }
  }, 10000);
}

function clearAccessAwayReport() {
  if (!state.accessAwayTimer) return;
  window.clearTimeout(state.accessAwayTimer);
  state.accessAwayTimer = null;
}

function sendAccessVisitDuration(options = {}) {
  if (!guestMode || !state.accessVisit) return;
  if (document.visibilityState === "hidden" && !options.away && !options.ended) return;
  const payload = {
    sessionId: state.accessVisit.sessionId,
    owner: getActiveOwnerScope(),
    path: window.location.pathname,
    durationMs: Date.now() - state.accessVisit.startedAt,
    ended: Boolean(options.ended),
    away: Boolean(options.away)
  };
  const body = JSON.stringify(payload);
  if (options.beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/access-log/visit", new Blob([body], { type: "application/json" }));
    if (!options.ended) return;
  }
  fetch("/api/access-log/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => {});
}

function createClientSessionId() {
  const key = `zend-notify-access-session:${window.location.pathname}`;
  try {
    const existing = window.sessionStorage?.getItem(key);
    if (existing) return existing;
    const next = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage?.setItem(key, next);
    return next;
  } catch {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function logGuestOperation(action, detail = "", options = {}) {
  const canLogAsGuest = hasGuestOwnerScope();
  const canLogAsAdmin = Boolean(options.allowAdmin) && !guestMode && state.authenticated;
  if (!canLogAsGuest && !canLogAsAdmin) return;
  fetch("/api/operation-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner: canLogAsGuest ? getActiveOwnerScope() : "",
      action,
      detail,
      path: window.location.pathname,
      allowAdmin: canLogAsAdmin
    }),
    keepalive: true
  }).catch(() => {});
}

function bindDefectTitleOperationLogs() {
  document.querySelectorAll("[data-defect-title-link]").forEach((link) => {
    if (link.dataset.operationBound === "true") return;
    link.dataset.operationBound = "true";
    link.addEventListener("click", () => {
      logGuestOperation("查看缺陷详情", `#${link.dataset.defectTitleLink || ""}`);
    });
  });
}

function getSelectedText(select) {
  return select?.selectedOptions?.[0]?.textContent?.trim() || select?.value || "";
}

function scopedApiUrl(path) {
  const owner = getActiveOwnerScope();
  if (!owner) return path;
  const params = new URLSearchParams({ owner });
  return `${path}?${params.toString()}`;
}

async function notifyGuestOwnerNewDefects(defects, shouldNotify) {
  if (!hasOwnerScope()) {
    state.guestKnownDefectIds = null;
    state.notificationOwnerScope = "";
    return;
  }
  const ownerScope = getActiveOwnerScope();
  const currentIds = new Set((defects || []).map((defect) => String(defect.id)).filter(Boolean));
  if (!state.guestKnownDefectIds || state.notificationOwnerScope !== ownerScope) {
    state.guestKnownDefectIds = currentIds;
    state.notificationOwnerScope = ownerScope;
    return;
  }

  const newDefects = (defects || []).filter((defect) => defect.id && !state.guestKnownDefectIds.has(String(defect.id)));
  state.guestKnownDefectIds = currentIds;
  if (!shouldNotify || !newDefects.length) return;

  showGuestDefectNotificationCards(newDefects);
  startNewDefectTitleScroll(newDefects.length);
  await showGuestBrowserNotification(newDefects);
}

function maybeShowGuestNotificationTest() {
  if (!hasGuestOwnerScope() || state.guestNotificationTestShown) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("testNewDefect") !== "1") return;
  state.guestNotificationTestShown = true;
  const testDefects = Array.from({ length: 5 }, (_, index) => {
    const id = `TEST-${index + 1}`;
    const now = new Date(Date.now() - index * 1000).toISOString();
    return {
      id,
      title: `测试新缺陷 ${index + 1}：通知卡片样式预览`,
      priority: index < 2 ? "1" : "3",
      status: "active",
      transferAt: index < 3 ? now : "",
      transferTo: index < 3 ? formatGuestOwnerDisplay(guestOwner) : "",
      assignedTo: formatGuestOwnerDisplay(guestOwner),
      openedBy: "测试创建人",
      openedDate: now,
      url: `http://zantao.landray.com.cn:8090/zentao/bug-view-${id}.html`
    };
  });
  showGuestDefectNotificationCards(testDefects);
  startNewDefectTitleScroll(testDefects.length);
  showGuestBrowserNotification(testDefects);
}

function showGuestDefectNotificationCards(defects) {
  const stack = document.getElementById("guestNotificationStack");
  if (!stack) return;
  const sortedDefects = sortNotificationDefects(defects).slice(0, 6);
  state.activeGuestNotificationCount += sortedDefects.length;
  sortedDefects.reverse().forEach((defect) => {
    const timeMeta = getNotificationDefectTimeMeta(defect);
    const personMeta = getNotificationDefectPersonMeta(defect);
    const card = document.createElement("article");
    card.className = `guest-defect-notification ${["1", "2"].includes(String(defect.priority)) ? "urgent" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `查看缺陷 #${defect.id}`);
    card.innerHTML = `
      <button type="button" class="guest-notification-close" aria-label="关闭通知">×</button>
      <div class="guest-notification-head">
        <span class="guest-notification-kicker">新缺陷提醒</span>
        <span class="guest-notification-id">#${escapeHtml(defect.id)}</span>
      </div>
      <div class="guest-notification-title">${escapeHtml(defect.title || "未命名缺陷")}</div>
      <div class="guest-notification-meta">
        <span class="${["1", "2"].includes(String(defect.priority)) ? "urgent" : ""}">P${escapeHtml(defect.priority || "-")}</span>
        ${timeMeta ? `<span class="has-tooltip" data-tooltip="${escapeHtml(timeMeta.title)}">${escapeHtml(timeMeta.text)}</span>` : ""}
        ${personMeta ? `<span class="has-tooltip" data-tooltip="${escapeHtml(personMeta.title)}">${escapeHtml(personMeta.text)}</span>` : ""}
      </div>
    `;
    card.addEventListener("click", (event) => {
      if (event.target.closest(".guest-notification-close")) return;
      if (defect.url) window.open(defect.url, "_blank", "noopener");
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (defect.url) window.open(defect.url, "_blank", "noopener");
    });
    card.querySelector(".guest-notification-close").addEventListener("click", (event) => {
      event.stopPropagation();
      closeGuestDefectNotification(card);
    });
    stack.prepend(card);
  });
}

function getNotificationDefectTimeMeta(defect) {
  const transferredAt = defect.transferAt || defect.assignedAt || "";
  if (transferredAt) return { text: formatCompactTime(transferredAt), title: "转入时间" };
  if (defect.openedDate) return { text: formatCompactTime(defect.openedDate), title: "创建时间" };
  return null;
}

function getNotificationDefectPersonMeta(defect) {
  const transferredAt = defect.transferAt || defect.assignedAt || "";
  if (transferredAt) return { text: formatPersonDisplayName(defect.transferTo || defect.assignedTo || guestOwner), title: "转入人" };
  if (defect.openedBy) return { text: formatPersonDisplayName(defect.openedBy), title: "创建人" };
  return null;
}

function sortNotificationDefects(defects) {
  return [...(defects || [])].sort((left, right) => {
    const priorityDiff = priorityValue(left.priority) - priorityValue(right.priority);
    if (priorityDiff) return priorityDiff;
    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function closeGuestDefectNotification(card) {
  card.classList.add("closing");
  window.setTimeout(() => {
    card.remove();
    state.activeGuestNotificationCount = Math.max(0, state.activeGuestNotificationCount - 1);
    if (state.activeGuestNotificationCount === 0) stopNewDefectTitleScroll();
  }, 220);
}

async function showGuestBrowserNotification(defects) {
  if (!("Notification" in window) || !defects.length) return false;
  try {
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const first = defects[0];
    const title = defects.length === 1 ? "有1个新缺陷" : `有${defects.length}个新缺陷`;
    const body = `#${first.id} ${first.title || ""}`.trim();
    const notification = new Notification(title, {
      body,
      tag: `zend-notify-${getActiveOwnerScope() || "global"}`,
      renotify: true
    });
    notification.onclick = () => {
      window.focus();
      if (first.url) window.open(first.url, "_blank", "noopener");
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

function startNewDefectTitleScroll(count) {
  if (!count) return;
  window.clearInterval(state.titleScrollTimer);
  const message = `有${count}个新缺陷`;
  const separator = "   ";
  const baseTitle = state.originalTitle || document.title || "禅道钉钉通知助手";
  let text = `${message}${separator}${baseTitle}${separator}`;
  document.title = text;
  state.titleScrollTimer = window.setInterval(() => {
    text = text.slice(1) + text[0];
    document.title = text;
  }, 420);
}

function stopNewDefectTitleScroll() {
  window.clearInterval(state.titleScrollTimer);
  state.titleScrollTimer = null;
  document.title = state.originalTitle || "禅道钉钉通知助手";
}

async function refreshFromZentao() {
  setFetchButtonState(true);
  try {
    const response = await fetch("/api/actions/fetch", { method: "POST" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "抓取禅道数据失败");
    await loadAll({ notifyGuestNewDefects: true });
    showToast(`已抓取 ${data.count} 条缺陷数据`);
  } catch (error) {
    if (state.overview) renderOverview();
    if (state.defects.length) renderDefects({ updateRoute: state.view === "defects", replaceRoute: true });
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
    const previousLastFetchAt = state.lastFetchAt;
    renderStatus(status);
    const fetchFinished = wasFetching && !state.fetching;
    const fetchChanged = Boolean(previousLastFetchAt && status.lastFetchAt && status.lastFetchAt !== previousLastFetchAt);
    if (fetchFinished || fetchChanged) {
      try {
        await loadAll({ notifyGuestNewDefects: true });
      } catch (loadError) {
        if (state.overview) renderOverview();
        showToast(loadError.message || "同步后数据刷新失败，已保留上一次数据", "error");
      }
    }
  } catch {
    // The next poll will recover; keep the current UI state meanwhile.
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `${url} ${response.status}`);
  return data;
}

function pickSettledResult(result, fallback, errorMessage = "") {
  if (result.status === "fulfilled") return result.value;
  if (fallback !== undefined) return fallback;
  throw new Error(errorMessage || result.reason?.message || "请求失败");
}

function getFallbackConfigStatus() {
  const config = state.config || {};
  return {
    zentaoEnabled: Boolean(config.zentao?.enabled),
    dingtalkDryRun: config.dingtalk?.dryRun !== false,
    schedulerEnabled: config.scheduler?.enabled !== false,
    lastFetchAt: state.lastFetchAt,
    fetching: state.fetching
  };
}

function showGuestError(message) {
  const loginScreen = document.getElementById("loginScreen");
  document.body.classList.add("login-mode");
  loginScreen.classList.remove("hidden");
  loginScreen.innerHTML = `
    <div class="login-panel guest-error-panel" role="alert">
      <div class="brand login-brand">
        <div class="brand-mark">ZD</div>
        <div>
          <strong>访客地址不可用</strong>
          <span>人员不存在</span>
        </div>
      </div>
      <div class="guest-error-message">${escapeHtml(message)}</div>
      <a class="secondary guest-error-link" href="/guest">返回访客总览</a>
    </div>
  `;
}

function getViewFromRoute() {
  const { view } = parseRoute();
  return view && titles[view] && allowedViews.includes(view) ? view : "overview";
}

function parseRoute() {
  const hash = window.location.hash || viewRoutes.overview;
  const [path, query = ""] = hash.split("?");
  const routeView = Object.entries(viewRoutes).find(([, route]) => route === path)?.[0];
  if (routeView) return { owner: "", view: routeView, path, params: new URLSearchParams(query) };

  const parts = path.replace(/^#\/?/, "").split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (!guestMode && parts.length >= 2 && titles[parts[1]]) {
    return { owner: parts[0], view: parts[1], path, params: new URLSearchParams(query) };
  }
  return { owner: "", view: "overview", path, params: new URLSearchParams(query) };
}

function switchView(view, options = {}) {
  if (!titles[view] || !allowedViews.includes(view)) view = "overview";
  const viewChanged = state.view !== view;
  state.view = view;
  document.querySelector(".main").classList.toggle("list-mode", ["defects", "logs", "accessLogs", "operationLogs", "syncLogs"].includes(view));
  document.querySelector(".main").classList.toggle("settings-mode", view === "settings");
  placeHeroForView(view);
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((element) => element.classList.remove("active"));
  document.getElementById(`${view}View`).classList.add("active");
  document.getElementById("viewTitle").textContent = titles[view][0];
  document.getElementById("viewSubtitle").textContent = titles[view][1];
  renderOwnerScopeBadge();
  updateMobileLogBackTop();

  const nextRoute = getScopedViewRoute(view);
  if (options.updateRoute !== false && options.replaceRoute && window.location.hash !== nextRoute) {
    window.history.replaceState(null, "", nextRoute);
  } else if (options.updateRoute !== false && window.location.hash !== nextRoute) {
    window.location.hash = nextRoute;
  }

  if (viewChanged && window.matchMedia("(max-width: 760px)").matches) {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      updateMobileLogBackTop();
    });
  }
}

function placeHeroForView(view) {
  const main = document.querySelector(".main");
  const hero = document.querySelector(".hero");
  const settingsScroll = document.querySelector("#settingsView .settings-scroll");
  if (!main || !hero || !settingsScroll) return;
  if (view === "settings") {
    if (hero.parentElement !== settingsScroll) settingsScroll.prepend(hero);
    return;
  }
  if (hero.parentElement !== main) main.insertBefore(hero, main.querySelector(".view"));
}

function getScopedViewRoute(view) {
  if (!guestMode && state.ownerScope) return `#/${encodeURIComponent(state.ownerScope)}/${view}`;
  return viewRoutes[view];
}

function renderStatus(status) {
  renderLastSyncTime(status.lastFetchAt);
  setFetchButtonState(Boolean(status.fetching));
  document.getElementById("configStatus").innerHTML = `
    <div class="status-row"><span>禅道抓取</span><strong>${status.zentaoEnabled ? "已启用" : "示例数据"}</strong></div>
    <div class="status-row"><span>钉钉推送</span><strong>${status.dingtalkDryRun ? "Dry-run" : "真实发送"}</strong></div>
    <div class="status-row"><span>定时任务</span><strong>${status.schedulerEnabled ? "已开启" : "已关闭"}</strong></div>
  `;
}

function setFetchButtonState(fetching) {
  state.fetching = fetching;
  ["refreshBtn", "mobileRefreshBtn"].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = fetching;
    button.classList.toggle("loading", fetching);
    button.removeAttribute("title");
    button.removeAttribute("aria-label");
  });
}

function renderLastSyncTime(value) {
  if (value !== undefined) state.lastFetchAt = value || "";
  const text = `最近更新：${formatCompactTime(state.lastFetchAt)}`;
  const element = document.getElementById("lastSyncText");
  if (element) element.textContent = text;
  const mobileElement = document.getElementById("mobileLastSyncText");
  if (mobileElement) mobileElement.textContent = `更新：${formatCompactTime(state.lastFetchAt)}`;
}

function renderOverview() {
  const overview = state.overview;
  if (!overview && state.loadingOverview) {
    renderOverviewLoading();
    return;
  }
  if (!overview) return;

  const metrics = getOverviewMetrics(overview);
  const canOperateCards = canOperateOverviewDefectCards();

  document.getElementById("metrics").innerHTML = metrics.map(([label, value, tone, mode]) => `
    <button class="metric ${tone}" type="button" data-defect-mode="${mode}">
      <span class="metric-heading">
        <span class="metric-icon" aria-hidden="true">${metricIcon(label)}</span>
        <span class="metric-label">${label}</span>
      </span>
      <strong>${value}</strong>
      <span class="metric-foot">${metricFoot(label)}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-defect-mode]").forEach((button) => {
    button.addEventListener("click", () => openDefectList(button.dataset.defectMode));
  });

  document.getElementById("urgentList").innerHTML = renderDefectCards(sortPinnedDefectCards(sortDefectsForDisplay(overview.urgentOpen)), true, canOperateCards);
  document.getElementById("normalList").innerHTML = renderDefectCards(sortPinnedDefectCards(sortDefectsForDisplay(overview.normalOpen)), false, canOperateCards);
  document.getElementById("urgentCount").textContent = overview.urgentOpen.length;
  document.getElementById("normalCount").textContent = overview.normalOpen.length;
  document.getElementById("mobileUrgentCount").textContent = overview.urgentOpen.length;
  document.getElementById("mobileNormalCount").textContent = overview.normalOpen.length;
  document.querySelector('[data-mobile-overview-more="urgent"]')?.classList.toggle("hidden", overview.urgentOpen.length <= 4);
  document.querySelector('[data-mobile-overview-more="normal"]')?.classList.toggle("hidden", overview.normalOpen.length <= 4);
  setMobilePendingPanel(state.mobilePendingPanel);
  document.querySelectorAll("[data-pin-defect]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleOverviewDefectPin(button.dataset.pinDefect);
    });
  });
  document.querySelectorAll("[data-requirement-defect]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleOverviewDefectRequirement(button.dataset.requirementDefect);
    });
  });
  document.querySelectorAll("[data-difficulty-defect]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDifficultyMenu(button, button.dataset.difficultyDefect);
    });
  });
  bindDefectTitleOperationLogs();

  const ownerStatsPanel = document.querySelector(".owner-stats-panel");
  ownerStatsPanel?.classList.toggle("hidden", hasOwnerScope());
  if (hasOwnerScope()) return;

  document.getElementById("ownerTable").innerHTML = renderTable(
    ["负责人", "未处理缺陷", "P1/P2 未处理", "普通未处理", "待测试", "今日新增", "今日转出", "今日转入", "今日解决"],
    overview.owners.map((owner) => [
      ownerGuestLink(owner),
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
  renderMobileOwnerComparison(overview.owners);
  document.querySelectorAll("[data-owner-stat-mode]").forEach((button) => {
    button.addEventListener("click", () => openOwnerDefectList(button.dataset.ownerStatMode, button.dataset.owner));
  });
}

function renderOverviewLoading() {
  const metrics = hasOwnerScope()
    ? ["今日新增", "今日解决", "今日关闭", "今日转出", "今日转入", "未完成总数", "P1/P2 未完成", "非 P1/P2 未完成", "已解决待验证", "异常数据"]
    : ["今日新增", "今日解决", "今日关闭", "异常数据", "未完成总数", "P1/P2 未完成", "非 P1/P2 未完成", "已解决待验证"];
  document.getElementById("metrics").innerHTML = metrics.map((label) => `
    <div class="metric loading-metric" aria-busy="true">
      <span class="metric-heading">
        <span class="metric-icon loading-metric-icon"></span>
        <span class="metric-label">${escapeHtml(label)}</span>
      </span>
      <strong><span class="loading-number"></span></strong>
      <span class="metric-foot"><span class="loading-line short"></span></span>
    </div>
  `).join("");

  document.getElementById("urgentCount").innerHTML = `<span class="loading-dot"></span>`;
  document.getElementById("normalCount").innerHTML = `<span class="loading-dot"></span>`;
  document.getElementById("mobileUrgentCount").innerHTML = `<span class="loading-dot"></span>`;
  document.getElementById("mobileNormalCount").innerHTML = `<span class="loading-dot"></span>`;
  document.getElementById("urgentList").innerHTML = renderDefectListLoading();
  document.getElementById("normalList").innerHTML = renderDefectListLoading();

  const ownerStatsPanel = document.querySelector(".owner-stats-panel");
  ownerStatsPanel?.classList.toggle("hidden", hasOwnerScope());
  if (!hasOwnerScope()) {
    document.getElementById("ownerTable").innerHTML = renderOwnerTableLoading();
    document.getElementById("mobileOwnerComparison").innerHTML = `
      <div class="mobile-owner-comparison-head">
        <strong>负责人统计</strong>
        <span>数据加载中</span>
      </div>
      <div class="mobile-owner-comparison-loading">
        ${Array.from({ length: 4 }).map(() => '<span class="loading-line"></span>').join("")}
      </div>
    `;
  }
}

function renderMobileOwnerComparison(owners) {
  const options = [
    { key: "open", label: "未完成", mode: "ownerOpen", tone: "total", value: getOwnerOpenTotal },
    { key: "urgent", label: "P1/P2", mode: "ownerUrgent", tone: "urgent", value: (owner) => Number(owner.urgentOpen || 0) },
    { key: "todayAdded", label: "今日新增", mode: "ownerTodayAdded", tone: "incoming", value: (owner) => Number(owner.todayAdded || 0) },
    { key: "todayResolved", label: "今日解决", mode: "ownerTodayResolved", tone: "done", value: (owner) => Number(owner.todayResolved || 0) },
    { key: "transferred", label: "今日转出", mode: "ownerTodayTransferred", tone: "normal", value: (owner) => Number(owner.todayTransferred || 0) },
    { key: "returned", label: "今日转入", mode: "ownerTodayReturned", tone: "incoming", value: (owner) => Number(owner.todayReturned || 0) }
  ];
  const selected = options.find((option) => option.key === state.mobileOwnerMetric) || options[0];
  state.mobileOwnerMetric = selected.key;
  const rows = [...(owners || [])]
    .map((owner) => ({ owner, value: selected.value(owner) }))
    .sort((left, right) => right.value - left.value || String(left.owner.name || "").localeCompare(String(right.owner.name || ""), "zh-CN"));
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  const container = document.getElementById("mobileOwnerComparison");
  if (!container) return;
  container.innerHTML = `
    <div class="mobile-owner-comparison-head">
      <strong>负责人统计</strong>
      <span>${rows.length} 人</span>
    </div>
    <div class="mobile-owner-metric-tabs" role="tablist" aria-label="负责人统计口径">
      ${options.map((option) => `<button class="${option.key === selected.key ? "active" : ""}" type="button" role="tab" aria-selected="${option.key === selected.key}" data-mobile-owner-metric="${option.key}">${option.label}</button>`).join("")}
    </div>
    <div class="mobile-owner-comparison-list ${selected.tone}">
      ${rows.map(({ owner, value }, index) => `
        <div class="mobile-owner-comparison-row">
          <span class="mobile-owner-rank">${index + 1}</span>
          <span class="mobile-owner-name">${ownerGuestLink(owner, true)}</span>
          <button class="mobile-owner-value" type="button" data-owner-stat-mode="${selected.mode}" data-owner="${escapeHtml(owner.name || owner.account || "")}" aria-label="查看${escapeHtml(owner.name || owner.account || "")}的${selected.label}缺陷">
            <span class="mobile-owner-bar"><i style="width:${Math.max(value > 0 ? 8 : 0, Math.round(value / maxValue * 100))}%"></i></span>
            <strong>${value}</strong>
          </button>
        </div>
      `).join("") || '<div class="empty">暂无负责人数据</div>'}
    </div>
  `;
  container.querySelectorAll("[data-mobile-owner-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mobileOwnerMetric = button.dataset.mobileOwnerMetric;
      renderOverview();
    });
  });
}

function renderDefectListLoading() {
  return Array.from({ length: 3 }).map(() => `
    <article class="defect-item loading-card" aria-busy="true">
      <div class="defect-title">
        <span class="loading-line id"></span>
        <span class="loading-line title"></span>
      </div>
      <div class="meta">
        <span class="loading-pill"></span>
        <span class="loading-pill wide"></span>
        <span class="loading-line meta-line"></span>
      </div>
    </article>
  `).join("");
}

function renderOwnerTableLoading() {
  const headers = ["负责人", "未处理缺陷", "P1/P2 未处理", "普通未处理", "待测试", "今日新增", "今日转出", "今日转入", "今日解决"];
  return `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${Array.from({ length: 4 }).map(() => `
          <tr>
            ${headers.map((_, index) => `<td><span class="loading-line ${index === 0 ? "owner" : "cell"}"></span></td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function getOverviewMetrics(overview) {
  if (hasOwnerScope()) {
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

function renderDefectCards(defects, urgent, canOperateCards = false) {
  if (!defects.length) return `<div class="empty">暂无数据</div>`;
  return defects.map((defect) => {
    const ageLabel = getOpenedAgeLabel(defect.openedDate);
    const pinned = isOverviewDefectPinned(defect.id);
    const requirement = isOverviewDefectRequirement(defect.id);
    const difficulty = getOverviewDefectDifficulty(defect.id);
    return `
    <article class="defect-item ${urgent ? "urgent" : ""} ${isFatal(defect) ? "fatal" : ""} ${ageLabel === "超期" ? "overdue" : ""} ${pinned ? "pinned" : ""}">
      <div class="defect-title">
        <span class="defect-id">#${escapeHtml(defect.id)}</span>
        <a class="defect-title-text" href="${escapeHtml(defect.url || "#")}" target="_blank" rel="noreferrer" data-defect-title-link="${escapeHtml(defect.id)}" title="${escapeHtml(defect.title)}">${escapeHtml(defect.title)}</a>
        ${canOperateCards ? `<div class="defect-actions"><button class="pin-defect-button ${pinned ? "active" : ""}" type="button" data-pin-defect="${escapeHtml(defect.id)}" title="${pinned ? "取消置顶" : "置顶"}" aria-label="${pinned ? "取消置顶" : "置顶"}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path class="pin-top-bar" d="M6 4h12" />
            <path class="pin-top-arrow" d="M12 19V8" />
            <path class="pin-top-arrow" d="M7.5 12.5L12 8l4.5 4.5" />
          </svg>
        </button>
        <button class="requirement-defect-button ${requirement ? "active" : ""}" type="button" data-requirement-defect="${escapeHtml(defect.id)}" title="${requirement ? "取消需求标记" : "标记为需求"}" aria-label="${requirement ? "取消需求标记" : "标记为需求"}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 12v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5H14" />
            <path d="M8 8h5" />
            <path d="M8 12h8" />
            <path d="M8 16h6" />
            <path d="M16 4.5h4v4" />
            <path d="M14.5 10 20 4.5" />
          </svg>
        </button>
        <button class="difficulty-defect-button ${difficulty ? "active" : ""}" type="button" data-difficulty-defect="${escapeHtml(defect.id)}" title="${difficulty ? `修复难度：${escapeHtml(getDifficultyLabel(difficulty))}` : "标记修复难度"}" aria-label="标记修复难度">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19h16" />
            <path d="M6 16V9" />
            <path d="M12 16V5" />
            <path d="M18 16v-4" />
          </svg>
        </button></div>` : ""}
      </div>
      <div class="meta">
        ${pinned ? `<span class="pill pinned">置顶</span>` : ""}
        ${requirement ? `<span class="pill requirement">需求</span>` : ""}
        ${difficulty ? `<span class="pill difficulty ${escapeHtml(difficulty)}">${escapeHtml(getDifficultyLabel(difficulty))}</span>` : ""}
        ${isFatal(defect) ? `<span class="pill fatal">致命</span>` : ""}
        ${renderNewPendingPill(defect)}
        ${renderTransferredInPill(defect)}
        ${isReactivatedByTestToFrontendDefect(defect) ? `<span class="pill reactivated">重新激活</span>` : ""}
        ${renderAgePill(defect, ageLabel)}
        <span class="pill ${urgent ? "urgent" : ""}">P${escapeHtml(defect.priority)}</span>
        <span class="meta-owner">负责人：${escapeHtml(defect.assignedTo || "未指派")}</span>
      </div>
    </article>
  `;
  }).join("");
}

function sortPinnedDefectCards(defects) {
  return [...defects].sort((left, right) => {
    const pinnedDiff = Number(isOverviewDefectPinned(right.id)) - Number(isOverviewDefectPinned(left.id));
    if (pinnedDiff) return pinnedDiff;
    return 0;
  });
}

function isOverviewDefectPinned(id) {
  return state.pinnedOverviewDefects.has(String(id));
}

function isOverviewDefectRequirement(id) {
  return state.requirementOverviewDefects.has(String(id));
}

function getOverviewDefectDifficulty(id) {
  return normalizeDifficulty(state.overviewDefectDifficulties[String(id)] || "");
}

function normalizeDifficulty(value) {
  const text = String(value || "").trim();
  return difficultyOptions.some((option) => option.value === text) ? text : "";
}

function getDifficultyLabel(value) {
  return difficultyOptions.find((option) => option.value === value)?.label || "";
}

function normalizeOverviewDifficulties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([id, difficulty]) => [
    String(id || "").trim(),
    normalizeDifficulty(difficulty)
  ]).filter(([id, difficulty]) => id && difficulty));
}

async function toggleOverviewDefectPin(id) {
  const key = String(id || "");
  if (!key) return;
  const previousPinned = new Set(state.pinnedOverviewDefects);
  if (state.pinnedOverviewDefects.has(key)) state.pinnedOverviewDefects.delete(key);
  else state.pinnedOverviewDefects.add(key);
  renderOverview();
  try {
    await saveOverviewPins();
    logGuestOperation(state.pinnedOverviewDefects.has(key) ? "标记置顶" : "取消置顶", `#${key}`, { allowAdmin: true });
  } catch (error) {
    state.pinnedOverviewDefects = previousPinned;
    renderOverview();
    showToast(error.message || "置顶保存失败", "error");
  }
}

async function saveOverviewPins() {
  const response = await fetch(overviewOperationUrl("/api/overview-pins"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned: [...state.pinnedOverviewDefects] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || "置顶保存失败");
  state.pinnedOverviewDefects = new Set((data.pinned || []).map((id) => String(id)));
}

async function toggleOverviewDefectRequirement(id) {
  const key = String(id || "");
  if (!key) return;
  const removing = state.requirementOverviewDefects.has(key);
  if (removing) {
    const confirmed = await requestConfirm({
      title: "取消需求标记",
      message: `确认取消 #${key} 的需求标记吗？取消后该缺陷不再显示“需求”标签。`,
      confirmText: "确认取消"
    });
    if (!confirmed) return;
  }
  const previousRequirements = new Set(state.requirementOverviewDefects);
  if (removing) state.requirementOverviewDefects.delete(key);
  else state.requirementOverviewDefects.add(key);
  renderOverview();
  try {
    await saveOverviewRequirements();
    logGuestOperation(removing ? "取消需求标记" : "标记为需求", `#${key}`, { allowAdmin: true });
  } catch (error) {
    state.requirementOverviewDefects = previousRequirements;
    renderOverview();
    showToast(error.message || "需求标记保存失败", "error");
  }
}

async function saveOverviewRequirements() {
  const response = await fetch(overviewOperationUrl("/api/overview-requirements"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirements: [...state.requirementOverviewDefects] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || "需求标记保存失败");
  state.requirementOverviewDefects = new Set((data.requirements || []).map((id) => String(id)));
}

function openDifficultyMenu(button, id) {
  const key = String(id || "");
  if (!key) return;
  closeDifficultyMenu();

  const current = getOverviewDefectDifficulty(key);
  const menu = document.createElement("div");
  menu.className = "difficulty-menu";
  menu.dataset.difficultyMenu = key;
  menu.innerHTML = `
    ${difficultyOptions.map((option) => `
      <button class="${current === option.value ? "active" : ""}" type="button" data-difficulty-value="${escapeHtml(option.value)}">
        <span class="difficulty-dot ${escapeHtml(option.value)}"></span>
        <span>${escapeHtml(option.label)}</span>
      </button>
    `).join("")}
    ${current ? `<button class="muted" type="button" data-difficulty-value="">清除标记</button>` : ""}
  `;
  document.body.appendChild(menu);
  state.activeDifficultyMenu = menu;
  positionDifficultyMenu(menu, button);
  menu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-difficulty-value]");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    setOverviewDefectDifficulty(key, option.dataset.difficultyValue);
  });
  window.setTimeout(() => {
    document.addEventListener("click", closeDifficultyMenuOnOutside, true);
    window.addEventListener("scroll", closeDifficultyMenu, true);
    window.addEventListener("resize", closeDifficultyMenu, { once: true });
  }, 0);
}

function positionDifficultyMenu(menu, button) {
  const rect = button.getBoundingClientRect();
  const width = 128;
  const gap = 6;
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  const top = Math.min(rect.bottom + gap, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function closeDifficultyMenuOnOutside(event) {
  if (event.target.closest(".difficulty-menu") || event.target.closest("[data-difficulty-defect]")) return;
  closeDifficultyMenu();
}

function closeDifficultyMenu() {
  if (state.activeDifficultyMenu) state.activeDifficultyMenu.remove();
  state.activeDifficultyMenu = null;
  document.removeEventListener("click", closeDifficultyMenuOnOutside, true);
  window.removeEventListener("scroll", closeDifficultyMenu, true);
}

async function setOverviewDefectDifficulty(id, difficulty) {
  const key = String(id || "");
  if (!key) return;
  const nextDifficulty = normalizeDifficulty(difficulty);
  const previousDifficulties = { ...state.overviewDefectDifficulties };
  closeDifficultyMenu();
  state.overviewDefectDifficulties = { ...state.overviewDefectDifficulties };
  if (nextDifficulty) state.overviewDefectDifficulties[key] = nextDifficulty;
  else delete state.overviewDefectDifficulties[key];
  renderOverview();
  try {
    await saveOverviewDifficulties();
    logGuestOperation(nextDifficulty ? "标记修复难度" : "清除修复难度", nextDifficulty ? `#${key} ${getDifficultyLabel(nextDifficulty)}` : `#${key}`, { allowAdmin: true });
  } catch (error) {
    state.overviewDefectDifficulties = previousDifficulties;
    renderOverview();
    showToast(error.message || "修复难度保存失败", "error");
  }
}

async function saveOverviewDifficulties() {
  const response = await fetch(overviewOperationUrl("/api/overview-difficulties"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ difficulties: state.overviewDefectDifficulties })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || "修复难度保存失败");
  state.overviewDefectDifficulties = normalizeOverviewDifficulties(data.difficulties);
}

function overviewOperationUrl(path) {
  if (!hasGuestOwnerScope()) return path;
  const params = new URLSearchParams({ owner: getActiveOwnerScope() });
  return `${path}?${params.toString()}`;
}

function ownerStatButton(owner, mode, value) {
  const disabled = Number(value) <= 0;
  return `<button class="owner-stat-link" type="button" data-owner-stat-mode="${escapeHtml(mode)}" data-owner="${escapeHtml(owner.account)}" ${disabled ? "disabled" : ""} title="${disabled ? "暂无缺陷" : `查看${escapeHtml(owner.name)}的缺陷详情`}">${escapeHtml(value)}</button>`;
}

function ownerGuestLink(owner, compact = false) {
  const name = owner.name || owner.account || "";
  const displayName = compact ? formatPersonDisplayName(name) : (name || "-");
  const guestAccount = getGuestAccountForOwner(owner);
  if (!guestAccount) return escapeHtml(displayName);
  const href = guestMode ? `/guest/${encodeURIComponent(guestAccount)}` : `#/${encodeURIComponent(guestAccount)}/overview`;
  const title = guestMode ? `以${escapeHtml(name)}视角打开访客页面` : `以${escapeHtml(name)}视角打开总览`;
  return `<a class="owner-guest-link" href="${href}" title="${title}">${escapeHtml(displayName)}</a>`;
}

function getGuestAccountForOwner(owner) {
  const normalized = normalizePersonName(owner.account || owner.name || "");
  if (!normalized) return "";
  const configured = state.config?.rules?.assignees || [];
  const configuredOwner = configured.find((assignee) => namesMatch(assignee, normalized));
  if (!configuredOwner) return "";
  return getGuestAccountAlias(configuredOwner);
}

function getGuestAccountAlias(ownerName) {
  const normalized = normalizePersonName(ownerName);
  const candidates = Object.entries(zentaoAccountAliases)
    .filter(([account, name]) => /^[a-z][a-z0-9-]*$/i.test(account) && normalizePersonName(name) === normalized)
    .map(([account]) => account)
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  return candidates[0] || "";
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
  if (!hasOwnerScope() && state.ownerFilters.length) defects = defects.filter((defect) => matchesOwnerFilters(defect, state.defectListMode));
  defects = applyDefectListMode(defects, state.defectListMode);
  defects = applyStatusFilter(defects, status);
  defects = applyOpenedAgeFilter(defects, openedAge);
  if (!["todayAdded", "resolvedPendingVerify", "ownerPendingTest", "ownerTodayAdded", "ownerTodayTransferred", "ownerTodayReturned"].includes(state.defectListMode)) {
    defects = defects.filter(isCurrentTerminalDefect);
  }
  defects = sortDefectsByMode(defects, sort, state.defectListMode);
  state.visibleDefects = defects;
  document.getElementById("defectsCount").textContent = defects.length;
  renderMobileFilterSummary();
  document.getElementById("defectsTable").classList.add("is-scrollable");
  renderDefectConditionBar();

  const modeDateColumn = getModeDateColumn(state.defectListMode, defects);
  const terminalDateColumn = modeDateColumn || getTerminalDateColumn(defects);
  const showResolverColumn = state.defectListMode !== "ownerTodayReturned" && shouldShowResolverColumn(defects, state.defectListMode);
  const showOwnerColumn = state.defectListMode !== "todayClosed";
  const showTransferToColumn = state.defectListMode === "ownerTodayTransferred";
  const showTransferFromColumn = state.defectListMode === "ownerTodayReturned";
  const showClosedByColumn = state.defectListMode === "todayClosed";
  const showCreatorColumn = ["todayAdded", "ownerTodayAdded"].includes(state.defectListMode);
  const headers = ["ID", "标题", "优先级", "状态"];
  if (showOwnerColumn) headers.push("负责人");
  if (showTransferToColumn) headers.push("转入人");
  if (showTransferFromColumn) headers.push("转出人");
  if (showResolverColumn) headers.push("解决人");
  if (showClosedByColumn) headers.push("由谁关闭");
  if (terminalDateColumn) headers.push(terminalDateColumn);
  if (showCreatorColumn) headers.push("创建人");
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
      if (showTransferToColumn) row.push(titledText(formatPersonDisplayName(getTransferTo(defect))));
      if (showTransferFromColumn) row.push(titledText(formatPersonDisplayName(defect.assignedFrom)));
      if (showResolverColumn) row.push(titledText(formatPersonDisplayName(getResolverNameForMode(defect, state.defectListMode))));
      if (showClosedByColumn) row.push(titledText(formatPersonDisplayName(defect.closedBy)));
      if (terminalDateColumn) row.push(formatTime(getModeDate(defect, state.defectListMode) || getTerminalDate(defect)));
      if (showCreatorColumn) row.push(titledText(formatPersonDisplayName(defect.openedBy)));
      row.push(formatTime(defect.openedDate));
      return row;
    }),
    "defects-data-table"
  );

  if (state.view === "defects" && options.updateRoute !== false) {
    updateDefectRoute(Boolean(options.replaceRoute));
  }
  bindDefectTitleOperationLogs();
}

function renderMobileFilterSummary() {
  syncMobileDefectSelects();
  const parts = [];
  const priority = document.getElementById("priorityFilter");
  const status = document.getElementById("statusFilter");
  const openedAge = document.getElementById("openedAgeFilter");
  const sort = document.getElementById("defectSort");
  if (priority?.value !== "all") parts.push(getSelectedText(priority));
  if (state.ownerFilters.length) parts.push(`${state.ownerFilters.length} 位负责人`);
  if (status?.value !== "active") parts.push(getSelectedText(status));
  if (openedAge?.value !== "all") parts.push(getSelectedText(openedAge));
  if (sort?.value !== "priorityHigh") parts.push(getSelectedText(sort));
  const summary = document.getElementById("mobileFilterSummary");
  if (summary) summary.textContent = parts.length ? parts.join(" · ") : "激活缺陷 · 优先级高到低";
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
  logGuestOperation("清除缺陷筛选");
}

function resetNormalDefectFilters() {
  resetDefectFiltersToDefault();
  renderOwnerFilterOptions();
  renderDefects();
  logGuestOperation("重置缺陷筛选");
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
  const ownerText = !hasOwnerScope() && state.ownerFilters.length ? ` · ${state.ownerFilters.join("、")}` : "";
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
  if (shouldIncludeIncomingTransfersInTodayAdded() && isTodayIncomingTransferToConfiguredDefect(defect)) {
    return `【由${formatPersonDisplayName(getTransferFrom(defect))}转入】`;
  }
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
  if (mode === "ownerTodayTransferred") return [getTransferFrom(defect)];
  if (mode === "ownerPendingTest") return [defect.assignedFrom];
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
    return configured.some((assignee) => namesMatch(getTransferFrom(defect), assignee));
  }
  if (mode === "todayAdded" && isTodayInitiallyAssignedDefect(defect)) {
    return configured.some((assignee) => namesMatch(getInitialAssignedTo(defect), assignee));
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
    todayAdded: () => shouldIncludeIncomingTransfersInTodayAdded() ? getAdminTodayAddedAt(defect) : defect.openedDate,
    todayResolved: () => getDeveloperResolvedAt(defect) || getTerminalDate(defect),
    todayClosed: () => defect.closedDate,
    resolvedPendingVerify: () => getDeveloperResolvedAt(defect) || getTerminalDate(defect),
    ownerTodayAdded: () => defect.openedDate,
    ownerTodayTransferred: () => getTransferAt(defect),
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
  state.ownerFilters = hasOwnerScope() ? [] : splitRouteList(params.get("owners"));
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
  if (!hasOwnerScope() && state.ownerFilters.length) params.set("owners", state.ownerFilters.join(","));
  return `${getScopedViewRoute("defects")}?${params.toString()}`;
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
    logGuestOperation("复制缺陷列表", `${defects.length} 条`);
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
  wrapper.classList.toggle("hidden", hasOwnerScope());
  if (hasOwnerScope()) {
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
  logGuestOperation("查看缺陷列表", defectModeText(mode));
}

function openOwnerDefectList(mode, owner) {
  state.defectListMode = mode;
  state.ownerFilters = hasOwnerScope() ? [] : (owner ? [owner] : []);
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

function defectModeText(mode) {
  const texts = {
    all: "全部缺陷",
    open: "未完成总数",
    urgent: "P1/P2 未完成",
    normal: "非 P1/P2 未完成",
    resolvedPendingVerify: "已解决待验证",
    abnormal: "异常数据",
    todayAdded: "今日新增",
    todayResolved: "今日解决",
    todayClosed: "今日关闭",
    todayTransferred: "今日转出",
    todayReturned: "今日转入",
    ownerOpen: "负责人未完成",
    ownerUrgent: "负责人 P1/P2 未完成",
    ownerNormal: "负责人非 P1/P2 未完成",
    ownerPendingTest: "负责人已解决待验证",
    ownerTodayAdded: "负责人今日新增",
    ownerTodayResolved: "负责人今日解决",
    ownerTodayTransferred: "负责人今日转出",
    ownerTodayReturned: "负责人今日转入"
  };
  return texts[mode] || mode || "-";
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
  if (mode === "todayAdded") return defects.filter(shouldIncludeIncomingTransfersInTodayAdded() ? isAdminTodayAddedDefect : (defect) => isToday(defect.openedDate));
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
  const allLogs = getRecentPushLogs();
  const logs = getVisibleMobileLogs(allLogs, "logs");
  if (!allLogs.length) {
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
            <tr class="clickable-row mobile-log-card ${log.ok ? "is-success" : "is-error"} ${log.id === state.selectedLogId ? "selected" : ""}" data-log-id="${escapeHtml(log.id)}">
              <td>${escapeHtml(formatTime(log.createdAt))}</td>
              <td>${escapeHtml(pushTypeText(log.type))}</td>
              <td>${escapeHtml(log.title)}</td>
              <td>${log.ok ? badge("success", log.dryRun ? "Dry-run 成功" : "成功") : badge("urgent", `失败：${log.error}`)}</td>
              <td>${escapeHtml(triggerText(log.trigger))}</td>
              <td>${escapeHtml(getLogAtText(log))}</td>
              <td>${escapeHtml((log.defectIds || []).length)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${renderMobileLogFooter("logs", logs.length, allLogs.length)}
    </div>
  `;

  document.querySelectorAll(".clickable-row").forEach((row) => {
    row.addEventListener("click", () => {
      const log = logs.find((item) => item.id === row.dataset.logId);
      if (log) openLogModal(log);
    });
  });
  bindMobileLogPagination("logs", allLogs.length, renderLogs);
}

function getLogAtText(log) {
  if (log.atAll) return "所有人";
  return (log.mobiles || []).join(", ") || "-";
}

function renderAccessLogs() {
  const allLogs = getRecentAccessLogs();
  const logs = getVisibleMobileLogs(allLogs, "accessLogs");
  document.getElementById("accessLogsTable").innerHTML = `
    <div class="table-scroll is-scrollable">
      <table class="access-logs-data-table">
        <thead>
          <tr>
            <th>访问时间</th>
            <th>访问时长</th>
            <th>会话状态</th>
            <th>IP</th>
            <th>访问对象</th>
            <th>类型</th>
            <th>路径</th>
          </tr>
        </thead>
        <tbody>
          ${logs.length ? logs.map((log) => `
            <tr class="mobile-log-card session-${["online", "away"].includes(log.sessionStatus) ? log.sessionStatus : "ended"}">
              <td>${escapeHtml(formatTime(log.accessedAt))}</td>
              <td>${escapeHtml(formatDuration(log.durationMs))}</td>
              <td>${sessionStatusBadge(log.sessionStatus)}</td>
              <td>${escapeHtml(log.ip || "-")}</td>
              <td>${escapeHtml(log.owner || "总览")}</td>
              <td>${escapeHtml(accessLogTypeText(log.type))}</td>
              <td>${escapeHtml(log.path || "-")}</td>
            </tr>
          `).join("") : `
            <tr>
              <td class="table-empty" colspan="7">暂无访问记录</td>
            </tr>
          `}
        </tbody>
      </table>
      ${renderMobileLogFooter("accessLogs", logs.length, allLogs.length)}
    </div>
  `;
  bindMobileLogPagination("accessLogs", allLogs.length, renderAccessLogs);
}

function getRecentAccessLogs() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return [...(state.accessLogs || [])]
    .filter((log) => {
      const time = new Date(log.accessedAt).getTime();
      return Number.isFinite(time) && time >= since;
    })
    .sort((a, b) => new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime());
}

function accessLogTypeText(type) {
  if (type === "page") return "页面访问";
  return type || "-";
}

function sessionStatusBadge(status) {
  if (status === "online") return `<span class="session-status online">正在访问</span>`;
  if (status === "away") return `<span class="session-status away">暂时离开</span>`;
  return `<span class="session-status ended">已结束</span>`;
}

function formatDuration(value) {
  const ms = Number(value) || 0;
  if (ms <= 0) return "-";
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return remainSeconds ? `${minutes}分${remainSeconds}秒` : `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours}小时${remainMinutes}分` : `${hours}小时`;
}

function renderOperationLogs() {
  const allLogs = getRecentOperationLogs();
  const logs = getVisibleMobileLogs(allLogs, "operationLogs");
  document.getElementById("operationLogsTable").innerHTML = `
    <div class="table-scroll is-scrollable">
      <table class="operation-logs-data-table">
        <thead>
          <tr>
            <th>操作时间</th>
            <th>IP</th>
            <th>操作人</th>
            <th>操作行为</th>
            <th>操作页面</th>
          </tr>
        </thead>
        <tbody>
          ${logs.length ? logs.map((log) => `
            <tr class="mobile-log-card is-operation">
              <td>${escapeHtml(formatTime(log.operatedAt))}</td>
              <td>${escapeHtml(log.ip || "-")}</td>
              <td>${escapeHtml(log.operator || "-")}</td>
              <td>${formatOperationAction(log)}</td>
              <td>${escapeHtml(log.path || "-")}</td>
            </tr>
          `).join("") : `
            <tr>
              <td class="table-empty" colspan="5">暂无操作记录</td>
            </tr>
          `}
        </tbody>
      </table>
      ${renderMobileLogFooter("operationLogs", logs.length, allLogs.length)}
    </div>
  `;
  bindMobileLogPagination("operationLogs", allLogs.length, renderOperationLogs);
}

function getRecentOperationLogs() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return [...(state.operationLogs || [])]
    .filter((log) => {
      const time = new Date(log.operatedAt).getTime();
      return Number.isFinite(time) && time >= since;
    })
    .sort((a, b) => new Date(b.operatedAt).getTime() - new Date(a.operatedAt).getTime());
}

function renderSyncLogs() {
  const allLogs = getRecentSyncLogs();
  const logs = getVisibleMobileLogs(allLogs, "syncLogs");
  document.getElementById("syncLogsTable").innerHTML = `
    <div class="table-scroll is-scrollable">
      <table class="sync-logs-data-table">
        <thead>
          <tr>
            <th>同步时间</th>
            <th>耗时</th>
            <th>同步结果</th>
            <th>触发</th>
            <th>同步模式</th>
            <th>同步数据</th>
          </tr>
        </thead>
        <tbody>
          ${logs.length ? logs.map((log) => `
            <tr class="mobile-log-card ${log.ok ? "is-success" : "is-error"}">
              <td>${escapeHtml(formatTime(log.startedAt || log.finishedAt))}</td>
              <td>${escapeHtml(formatDuration(getSyncLogDuration(log)))}</td>
              <td>${log.ok ? badge("success", "成功") : badge("urgent", `失败：${log.error || "-"}`)}</td>
              <td>${escapeHtml(triggerText(log.trigger))}</td>
              <td>${escapeHtml(syncModeText(log.syncMode))}</td>
              <td>${escapeHtml(formatSyncData(log))}</td>
            </tr>
          `).join("") : `
            <tr>
              <td class="table-empty" colspan="6">暂无同步记录</td>
            </tr>
          `}
        </tbody>
      </table>
      ${renderMobileLogFooter("syncLogs", logs.length, allLogs.length)}
    </div>
  `;
  bindMobileLogPagination("syncLogs", allLogs.length, renderSyncLogs);
}

function getVisibleMobileLogs(logs, key) {
  if (!window.matchMedia("(max-width: 760px)").matches) return logs;
  const limit = Math.max(mobileLogBatchSize, Number(state.mobileLogLimits[key]) || mobileLogBatchSize);
  return logs.slice(0, limit);
}

function renderMobileLogFooter(key, visibleCount, totalCount) {
  if (!window.matchMedia("(max-width: 760px)").matches || !totalCount) return "";
  const hasMore = visibleCount < totalCount;
  if (hasMore) {
    return `<button type="button" class="mobile-log-pagination has-more" data-mobile-log-pagination="${escapeHtml(key)}"><i aria-hidden="true"></i><span>上拉加载更多</span></button>`;
  }
  return `<div class="mobile-log-pagination finished" data-mobile-log-pagination="${escapeHtml(key)}"><span>已加载全部 ${totalCount} 条</span></div>`;
}

function bindMobileLogPagination(key, totalCount, render) {
  mobileLogObservers.get(key)?.disconnect();
  mobileLogObservers.delete(key);
  if (!window.matchMedia("(max-width: 760px)").matches) return;
  if ((Number(state.mobileLogLimits[key]) || mobileLogBatchSize) >= totalCount) return;

  window.requestAnimationFrame(() => {
    const target = document.querySelector(`[data-mobile-log-pagination="${key}"]`);
    if (!target) return;
    let loaded = false;
    const loadMore = () => {
      if (loaded) return;
      loaded = true;
      mobileLogObservers.get(key)?.disconnect();
      mobileLogObservers.delete(key);
      state.mobileLogLimits[key] = (Number(state.mobileLogLimits[key]) || mobileLogBatchSize) + mobileLogBatchSize;
      render();
    };
    target.addEventListener("click", loadMore, { once: true });
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      loadMore();
    }, { rootMargin: "120px 0px" });
    mobileLogObservers.set(key, observer);
    observer.observe(target);
  });
}

function getRecentSyncLogs() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return [...(state.syncLogs || [])]
    .filter((log) => {
      const time = new Date(log.startedAt || log.finishedAt).getTime();
      return Number.isFinite(time) && time >= since;
    })
    .sort((a, b) => new Date(b.startedAt || b.finishedAt).getTime() - new Date(a.startedAt || a.finishedAt).getTime());
}

function getSyncLogDuration(log) {
  const storedDuration = Number(log.durationMs);
  if (Number.isFinite(storedDuration) && storedDuration > 0) return storedDuration;
  const startedAt = new Date(log.startedAt).getTime();
  const finishedAt = new Date(log.finishedAt).getTime();
  if (Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt) return finishedAt - startedAt;
  return 0;
}

function syncModeText(mode) {
  if (mode === "incremental") return "增量";
  if (mode === "mixed") return "增量 + 新增负责人全量";
  if (mode === "full") return "全量";
  return mode || "-";
}

function formatSyncData(log) {
  if (!log.ok) return log.error || "同步失败";
  const parts = [];
  if (Number.isFinite(Number(log.count))) parts.push(`当前缺陷 ${Number(log.count)} 条`);
  if (Number.isFinite(Number(log.listCount))) parts.push(`列表 ${Number(log.listCount)} 条`);
  if (Number.isFinite(Number(log.detailCount))) parts.push(`详情 ${Number(log.detailCount)} 条`);
  if (Number.isFinite(Number(log.recentEditedCount)) && Number(log.recentEditedCount) > 0) parts.push(`近期编辑 ${Number(log.recentEditedCount)} 条`);
  if (Number.isFinite(Number(log.recentMatchedCount)) && Number(log.recentMatchedCount) > 0) parts.push(`匹配 ${Number(log.recentMatchedCount)} 条`);
  if (Array.isArray(log.addedAssignees) && log.addedAssignees.length) parts.push(`新增负责人 ${log.addedAssignees.join("、")}`);
  if (Number.isFinite(Number(log.recentDetailFailureCount)) && Number(log.recentDetailFailureCount) > 0) parts.push(`详情失败 ${Number(log.recentDetailFailureCount)} 条`);
  return parts.join("；") || "-";
}

function formatOperationAction(log) {
  const action = escapeHtml(log.action || "-");
  const detail = formatOperationDetail(log.detail);
  const compact = /^#\d+$/.test(String(log.detail || "").trim());
  return `<span class="operation-action-content${compact ? " compact" : ""}"><span class="operation-action-name">${action}</span>${detail ? `<span class="operation-action-separator">：</span><span class="operation-action-detail">${detail}</span>` : ""}</span>`;
}

function formatOperationDetail(detail) {
  const text = String(detail || "").trim();
  if (!text) return "";
  return escapeHtml(text).replace(/#(\d+)/g, (_match, id) => {
    const url = getDefectUrlById(id);
    if (!url) return `#${id}`;
    return `<a class="operation-defect-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">#${id}</a>`;
  });
}

function getDefectUrlById(id) {
  const key = String(id || "").trim();
  if (!key) return "";
  const defect = (state.defects || []).find((item) => String(item.id) === key);
  if (defect?.url) return defect.url;
  const baseUrl = String(state.config?.zentao?.baseUrl || "").replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/bug-view-${encodeURIComponent(key)}.html` : "";
}

function openLogModal(log) {
  state.selectedLogId = log.id;
  document.querySelectorAll(".clickable-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.logId === log.id);
  });
  document.getElementById("logModalTitle").textContent = "推送内容";
  document.getElementById("logModalMeta").textContent = `${log.title || pushTypeText(log.type)} · ${formatTime(log.createdAt)}`;
  document.getElementById("logPreviewTime").textContent = formatDingPreviewTime(log.createdAt);
  document.getElementById("logModalContent").innerHTML = renderMarkdown(log.text || "");
  document.getElementById("logModal").classList.remove("hidden");
  updateModalScrollLock();
}

function formatDingPreviewTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function closeLogModal() {
  document.getElementById("logModal").classList.add("hidden");
  updateModalScrollLock();
}

let pendingConfirmResolve = null;
function requestConfirm({ title, message, confirmText = "确认" }) {
  const modal = document.getElementById("confirmModal");
  document.getElementById("confirmModalTitle").textContent = title || "确认操作";
  document.getElementById("confirmModalMessage").textContent = message || "确认继续吗？";
  document.getElementById("confirmConfirmModal").textContent = confirmText;
  modal.classList.remove("hidden");
  updateModalScrollLock();
  document.getElementById("confirmConfirmModal").focus();
  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}

function closeConfirmModal(confirmed) {
  const modal = document.getElementById("confirmModal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  updateModalScrollLock();
  if (pendingConfirmResolve) {
    pendingConfirmResolve(Boolean(confirmed));
    pendingConfirmResolve = null;
  }
}

function updateModalScrollLock() {
  const hasOpenModal = [...document.querySelectorAll(".modal-backdrop")]
    .some((modal) => !modal.classList.contains("hidden"));
  document.body.classList.toggle("modal-open", hasOpenModal);
}

function getRecentPushLogs() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return [...(state.logs || [])]
    .filter((log) => {
      const time = new Date(log.createdAt).getTime();
      return Number.isFinite(time) && time >= since;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listType = "";

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = "";
  };

  const openList = (type) => {
    if (listType === type) return;
    closeList();
    html.push(`<${type}>`);
    listType = type;
  };

  lines.forEach((line) => {
    const indented = /^\s{2,}\S/.test(line);
    const text = line.trim();
    if (!text) {
      closeList();
      return;
    }

    const heading = text.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 4);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const quote = text.match(/^>\s?(.+)$/);
    if (quote) {
      closeList();
      const quoteText = quote[1].replace(/<br\s*\/?>(?:\s*)$/i, "");
      html.push(`<blockquote>${renderInlineMarkdown(quoteText)}</blockquote>`);
      return;
    }

    const orderedItem = text.match(/^\d+\.\s+(.+)$/);
    if (orderedItem) {
      openList("ol");
      html.push(`<li>${renderInlineMarkdown(orderedItem[1])}</li>`);
      return;
    }

    const listItem = text.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      openList("ul");
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      return;
    }

    if (indented && listType && html.length) {
      html[html.length - 1] = html[html.length - 1].replace(/<\/li>$/, ` ${renderInlineMarkdown(text)}</li>`);
      return;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(text)}</p>`);
  });

  closeList();
  return html.join("");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

async function loadConfig() {
  const panels = Array.from(document.querySelectorAll("#settingsView .form-panel"));
  panels.forEach((panel) => setDynamicRegionLoading(panel, true));
  try {
    const data = await getJson("/api/config");
    state.config = data.config;
    renderConfig();
    renderOwnerFilterOptions();
    if (state.view === "defects") renderDefects({ replaceRoute: true });
  } finally {
    panels.forEach((panel) => setDynamicRegionLoading(panel, false));
  }
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
  document.getElementById("dingAtAll").checked = Boolean(config.dingtalk.atAll);
  document.getElementById("dingWebhook").value = config.dingtalk.webhook || config.dingtalk.accessToken || "";
  document.getElementById("dingSecret").value = config.dingtalk.secret || "";
  document.getElementById("scheduleEnabled").checked = config.scheduler?.enabled !== false;
  document.getElementById("scheduleP1P2Enabled").checked = config.scheduler?.rules?.p1p2 !== false;
  document.getElementById("scheduleFetchMinutes").value = config.scheduler?.fetchEveryMinutes || config.scheduler?.ruleFetchEveryMinutes || 5;
  renderP1P2TimeInputs(config.scheduler.p1p2ReportTimes || [config.scheduler.p1p2ReportTime || "18:00"]);
  document.getElementById("adminToken").value = config.auth?.adminToken || "";
  renderGuestPasswordOwnerOptions(config.rules.assignees || []);
}

function renderGuestPasswordOwnerOptions(assignees) {
  const select = document.getElementById("guestPasswordOwnerSelect");
  if (!select) return;
  const options = (assignees || [])
    .map((name) => ({ name, account: getGuestAccountAlias(name) }))
    .filter((option) => option.account)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const current = options.find((option) => option.account === select.dataset.value) || options[0];
  select.dataset.value = current?.account || "";
  select.dataset.label = current?.name || "";
  select.classList.toggle("disabled", !options.length);
  select.innerHTML = `
    <button type="button" class="guest-password-owner-trigger" ${options.length ? "" : "disabled"}>
      <span>${escapeHtml(current?.name || "暂无可重置人员")}</span>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 7.5 10 12.5 15 7.5" />
      </svg>
    </button>
    <div class="guest-password-owner-menu">
      ${options.map((option) => `
        <button class="${option.account === current?.account ? "active" : ""}" type="button" data-guest-owner="${escapeHtml(option.account)}" data-guest-owner-name="${escapeHtml(option.name)}">
          ${escapeHtml(option.name)}
        </button>
      `).join("")}
    </div>
  `;
  select.querySelector(".guest-password-owner-trigger")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!options.length) return;
    if (select.classList.contains("open")) closeGuestPasswordOwnerSelect(select);
    else openGuestPasswordOwnerSelect(select);
  });
  select.querySelectorAll("[data-guest-owner]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      select.dataset.value = button.dataset.guestOwner || "";
      select.dataset.label = button.dataset.guestOwnerName || "";
      closeGuestPasswordOwnerSelect(select);
      renderGuestPasswordOwnerOptions(assignees);
    });
  });
  const button = document.getElementById("resetGuestPasswordBtn");
  if (button) button.disabled = !options.length;
}

function openGuestPasswordOwnerSelect(select) {
  select.classList.add("open");
  select.classList.remove("open-up");
  const trigger = select.querySelector(".guest-password-owner-trigger");
  const menu = select.querySelector(".guest-password-owner-menu");
  if (!trigger || !menu) return;
  const triggerRect = trigger.getBoundingClientRect();
  const menuHeight = Math.min(menu.scrollHeight, 260);
  const spaceBelow = window.innerHeight - triggerRect.bottom - 10;
  const spaceAbove = triggerRect.top - 10;
  select.classList.toggle("open-up", spaceBelow < menuHeight && spaceAbove > spaceBelow);
}

function closeGuestPasswordOwnerSelect(select) {
  select.classList.remove("open", "open-up");
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
      dingtalkAtAll: Boolean(state.config.dingtalk.atAll),
      schedulerEnabled: data.scheduler.enabled !== false
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

async function resetGuestPassword() {
  const select = document.getElementById("guestPasswordOwnerSelect");
  const owner = select?.dataset.value || "";
  const ownerName = select?.dataset.label || owner;
  if (!owner) return;
  const confirmed = await requestConfirm({
    title: "重置访客密码",
    message: `确认重置 ${ownerName} 的访客访问密码吗？重置后该人员下次访问个人页面需要重新设置初始化密码。`,
    confirmText: "确认重置"
  });
  if (!confirmed) return;

  try {
    const response = await fetch("/api/guest-passwords/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || data.error || "访客密码重置失败");
    showToast(`${ownerName} 的访客密码已重置`);
  } catch (error) {
    showToast(error.message || "访客密码重置失败", "error");
  }
}

async function saveConfig(event) {
  event.preventDefault();
  const result = document.getElementById("configResult");
  result.classList.add("hidden");
  result.textContent = "";
  showToast("配置保存中...");

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
      atAll: document.getElementById("dingAtAll").checked,
      webhook: document.getElementById("dingWebhook").value,
      secret: document.getElementById("dingSecret").value
    },
    scheduler: {
      enabled: document.getElementById("scheduleEnabled").checked,
      fetchEveryMinutes: Number(document.getElementById("scheduleFetchMinutes").value) || 5,
      p1p2ReportTimes: getP1P2ReportTimesFromForm(),
      rules: {
        p1p2: document.getElementById("scheduleP1P2Enabled").checked
      }
    },
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
        ${rows.map((row) => `<tr>${row.map((cell, index) => `<td class="${columnClasses[index]}" data-label="${escapeHtml(headers[index])}">${renderCell(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

function getColumnClass(header) {
  if (["负责人", "解决人", "创建人"].includes(header)) return "col-person";
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
      ${assignees.map((assignee) => {
        const guestAccount = getGuestAccountAlias(assignee);
        return `
          <div class="check-option">
            <label class="check-option-toggle">
              <input type="checkbox" name="ruleAssignee" value="${escapeHtml(assignee)}" ${selected.has(assignee) ? "checked" : ""}>
              <span>${escapeHtml(assignee)}</span>
            </label>
            ${guestAccount ? `
              <button type="button" class="assignee-guest-link-copy" data-copy-guest-link="${escapeHtml(guestAccount)}" data-tooltip="复制个人访问链接" aria-label="复制${escapeHtml(assignee)}的个人访问链接">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect width="13" height="13" x="9" y="9" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            ` : ""}
          </div>
        `;
      }).join("")}
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
  picker.querySelectorAll("[data-copy-guest-link]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const account = button.dataset.copyGuestLink || "";
      const url = new URL(`/guest/${encodeURIComponent(account)}`, window.location.origin).toString();
      try {
        await copyText(url);
        showToast("个人访问链接已复制");
      } catch (error) {
        showToast(error.message || "复制链接失败", "error");
      }
    });
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
  if (text.startsWith("<a class=\"owner-guest-link")) return text;
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
  return `<a class="ellipsis-cell title-link" href="${escapeHtml(defect.url || "#")}" target="_blank" rel="noreferrer" data-defect-title-link="${escapeHtml(defect.id)}" title="${escapeHtml(defect.title)}">${escapeHtml(defect.title)}</a>`;
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

function metricIcon(label) {
  const icons = {
    今日新增: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>',
    今日解决: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>',
    今日关闭: '<svg viewBox="0 0 24 24"><path d="M5 7h14v12H5zM4 4h16v3H4z" /><path d="M9 12h6" /></svg>',
    今日转出: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9" /></svg>',
    今日转入: '<svg viewBox="0 0 24 24"><path d="m17 7-10 10M16 17H7V8" /></svg>',
    异常数据: '<svg viewBox="0 0 24 24"><path d="M10.3 4.1 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>',
    未完成总数: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></svg>',
    "P1/P2 未完成": '<svg viewBox="0 0 24 24"><path d="M12 3 20 7v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4Z" /><path d="M12 8v5M12 16h.01" /></svg>',
    "非 P1/P2 未完成": '<svg viewBox="0 0 24 24"><path d="m4 7 2 2 3-3M11 8h9M4 13l2 2 3-3M11 14h9M4 19l2 2 3-3M11 20h9" /></svg>',
    已解决待验证: '<svg viewBox="0 0 24 24"><path d="M9 5H6a2 2 0 0 0-2 2v12h16V7a2 2 0 0 0-2-2h-3" /><path d="M9 3h6v4H9zM8 13l2.5 2.5L16 10" /></svg>'
  };
  return icons[label] || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>';
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
  return isWithinRecentHours(defect.openedDate, 4) && !isRecentlyTransferredInDefect(defect);
}

function renderNewPendingPill(defect) {
  if (!isNewPendingDefect(defect)) return "";
  return `<span class="pill new" title="${escapeHtml(getPendingTimeTooltip(defect))}">新</span>`;
}

function renderTransferredInPill(defect) {
  if (!isRecentlyTransferredInDefect(defect)) return "";
  return `<span class="pill transferred-in" data-tooltip="${escapeHtml(getPendingTimeTooltip(defect))}">转入</span>`;
}

function renderAgePill(defect, ageLabel) {
  if (!ageLabel) return "";
  const className = `pill age ${ageLabel === "超期" ? "overdue" : ""}`.trim();
  return `<span class="${className}" data-tooltip="${escapeHtml(getPendingTimeTooltip(defect))}">${ageLabel}</span>`;
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
  return Boolean(getTransferFrom(defect))
    && Boolean(getTransferTo(defect))
    && !namesMatch(getTransferFrom(defect), getTransferTo(defect))
    && isToday(getTransferAt(defect))
    && !isResolvedByTransferAction(defect);
}

function shouldIncludeIncomingTransfersInTodayAdded() {
  return !guestMode && !hasOwnerScope();
}

function isAdminTodayAddedDefect(defect) {
  return isToday(defect.openedDate) || isTodayIncomingTransferToConfiguredDefect(defect);
}

function getAdminTodayAddedAt(defect) {
  if (isToday(defect.openedDate)) return defect.openedDate;
  if (isTodayIncomingTransferToConfiguredDefect(defect)) return getTransferAt(defect);
  return "";
}

function isTodayIncomingTransferToConfiguredDefect(defect) {
  return Boolean(getTransferFrom(defect))
    && Boolean(getTransferTo(defect))
    && !namesMatch(getTransferFrom(defect), getTransferTo(defect))
    && isToday(getTransferAt(defect))
    && isFrontendOwner(getTransferTo(defect))
    && !isResolvedByTransferAction(defect);
}

function isResolvedByTransferAction(defect) {
  if (normalizeStatus(getTransferStatusAfter(defect)) === "resolved") return true;
  return Boolean(defect.resolvedDate)
    && normalizeDateMinute(defect.resolvedDate) === normalizeDateMinute(getTransferAt(defect))
    && namesMatch(defect.resolvedBy, getTransferFrom(defect));
}

function getTransferFrom(defect) {
  return defect.transferFrom || defect.assignedFrom || "";
}

function getTransferTo(defect) {
  return defect.transferTo || defect.assignedTo || "";
}

function getTransferAt(defect) {
  return defect.transferAt || defect.assignedAt || "";
}

function getTransferStatusAfter(defect) {
  return defect.transferStatusAfter || defect.assignedStatusAfter || "";
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
    && isFrontendOwner(getResolverName(defect));
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
