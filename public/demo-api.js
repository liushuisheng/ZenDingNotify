(function initDemoApi() {
  "use strict";

  window.__ZEN_DING_DEMO__ = true;
  document.body.classList.add("demo-mode");
  [
    "zentaoEnabled",
    "zentaoBaseUrl",
    "zentaoAccount",
    "zentaoPassword",
    "zentaoCookie",
    "dingDryRun",
    "dingWebhook",
    "dingSecret"
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.disabled = true;
  });

  const STORAGE_KEY = "zend-ding-notify-demo-state-v1";
  const AUTH_KEY = "zend-ding-notify-demo-auth";
  const ADMIN_PASSWORD = "123456";
  const assignees = ["刘水生", "李思成", "王思鑫", "潘文豪", "谌祖恒", "马陈绵"];
  const aliases = {
    刘水生: "liuss",
    李思成: "lisicheng",
    王思鑫: "wangsixin",
    潘文豪: "panwenhao",
    谌祖恒: "tanzuheng",
    马陈绵: "machm"
  };

  const pad = (value) => String(value).padStart(2, "0");
  const dateTime = (dayOffset = 0, hour = 9, minute = 0, second = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hour, minute, second, 0);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  const now = () => dateTime(0, new Date().getHours(), new Date().getMinutes(), new Date().getSeconds());
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const randomId = () => `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function defect(id, title, priority, assignedTo, options = {}) {
    const status = options.status || "active";
    return {
      id: String(id),
      title,
      status,
      priority: String(priority),
      severity: String(priority),
      assignedTo,
      openedBy: options.openedBy || "产品体验员",
      openedDate: options.openedDate || dateTime(options.openedDay ?? -2, 10, 20, Number(id) % 50),
      resolvedDate: options.resolvedDate || "",
      resolvedBy: options.resolvedBy || "",
      closedDate: options.closedDate || "",
      closedBy: options.closedBy || "",
      activatedDate: options.activatedDate || "",
      activatedBy: options.activatedBy || "",
      initialAssignedTo: options.initialAssignedTo || assignedTo,
      assignedFrom: options.assignedFrom || "",
      assignedAt: options.assignedAt || "",
      assignedStatusAfter: options.assignedStatusAfter || status,
      transferFrom: options.transferFrom || options.assignedFrom || "",
      transferTo: options.transferTo || "",
      transferAt: options.transferAt || "",
      transferStatusAfter: options.transferStatusAfter || status,
      lastEditedDate: options.lastEditedDate || options.openedDate || dateTime(-1, 16, 30, 0),
      recentlyEdited: Boolean(options.recentlyEdited),
      url: `https://example.com/demo/defects/${id}`
    };
  }

  function createSeedState() {
    const defects = [
      defect(90001, "移动端审批页在窄屏下操作区发生遮挡", 1, "刘水生", { openedDay: 0, openedBy: "周产品" }),
      defect(90002, "消息中心未读数量在切换组织后没有刷新", 2, "李思成", { openedDay: 0, openedBy: "林测试" }),
      defect(90003, "流程表单字段较多时首屏加载速度偏慢", 2, "王思鑫", { openedDay: -1, openedBy: "周产品" }),
      defect(90004, "导出文件名称需要包含业务日期", 3, "潘文豪", { openedDay: -3, openedBy: "陈业务" }),
      defect(90005, "列表筛选条件在返回页面后应继续保留", 3, "谌祖恒", { openedDay: -2, openedBy: "林测试" }),
      defect(90006, "低代码页面复制组件后间距配置未继承", 4, "马陈绵", { openedDay: -4, openedBy: "周产品" }),
      defect(90007, "个人中心头像上传后缓存未及时更新", 2, "陈加鹏", {
        status: "resolved",
        openedDay: -2,
        resolvedDate: dateTime(0, 10, 16, 20),
        resolvedBy: "刘水生",
        assignedFrom: "刘水生",
        assignedAt: dateTime(0, 10, 17, 5),
        transferFrom: "刘水生",
        transferTo: "陈加鹏",
        transferAt: dateTime(0, 10, 17, 5),
        transferStatusAfter: "resolved"
      }),
      defect(90008, "工作台卡片排序在刷新后恢复默认", 3, "陈加鹏", {
        status: "resolved",
        openedDay: -5,
        resolvedDate: dateTime(0, 11, 8, 12),
        resolvedBy: "李思成",
        assignedFrom: "李思成",
        assignedAt: dateTime(0, 11, 9, 0),
        transferFrom: "李思成",
        transferTo: "陈加鹏",
        transferAt: dateTime(0, 11, 9, 0),
        transferStatusAfter: "resolved"
      }),
      defect(90009, "流程抄送人搜索结果需要展示所属部门", 2, "王思鑫", {
        status: "closed",
        openedDay: -6,
        resolvedDate: dateTime(-1, 15, 20, 0),
        resolvedBy: "王思鑫",
        closedDate: dateTime(0, 9, 42, 10),
        closedBy: "林测试"
      }),
      defect(90010, "附件预览关闭后页面滚动位置发生变化", 3, "潘文豪", {
        status: "closed",
        openedDay: -4,
        resolvedDate: dateTime(-1, 14, 12, 0),
        resolvedBy: "潘文豪",
        closedDate: dateTime(0, 13, 6, 28),
        closedBy: "林测试"
      }),
      defect(90011, "表格列宽拖动到最小时标题显示不完整", 2, "李思成", {
        openedDay: -2,
        assignedFrom: "刘水生",
        assignedAt: dateTime(0, 14, 25, 31),
        transferFrom: "刘水生",
        transferTo: "李思成",
        transferAt: dateTime(0, 14, 25, 31),
        transferStatusAfter: "active"
      }),
      defect(90012, "审批意见为空时不应展示占位符", 3, "刘水生", {
        openedDay: -3,
        assignedFrom: "王思鑫",
        assignedAt: dateTime(0, 15, 3, 8),
        transferFrom: "王思鑫",
        transferTo: "刘水生",
        transferAt: dateTime(0, 15, 3, 8),
        transferStatusAfter: "active"
      })
    ];

    const pushText = [
      "### 今日 P1/P2 缺陷风险提醒",
      "",
      "#### 📌 关键数据",
      "> 今日新增缺陷：**2** 个",
      "> 今日已修复缺陷：**2** 个",
      "> 当前剩余 P1/P2 未完成：**4** 个",
      "",
      "#### 📋 待处理明细",
      "",
      "1. #90001 [P1] 移动端审批页在窄屏下操作区发生遮挡",
      "",
      "   负责人：**刘水生**  [查看缺陷](https://example.com/demo/defects/90001)",
      "",
      "2. #90002 [P2] 消息中心未读数量在切换组织后没有刷新",
      "",
      "   负责人：**李思成**  [查看缺陷](https://example.com/demo/defects/90002)",
      "",
      "> 演示数据仅用于体验界面与操作流程。"
    ].join("\n");

    return {
      defects,
      pins: ["90001"],
      requirements: ["90005"],
      difficulties: { "90001": "hard", "90004": "simple" },
      config: createDemoConfig(),
      pushLogs: [
        { id: "push-1", type: "TODAY_P1P2_RISK_REPORT", title: "今日 P1/P2 缺陷风险提醒", text: pushText, mobiles: [], defectIds: ["90001", "90002", "90003", "90011"], trigger: "schedule", ok: true, dryRun: true, atAll: true, error: "", createdAt: dateTime(0, 18, 0, 5) },
        { id: "push-2", type: "OVERDUE_DEFECT_REPORT", title: "超期缺陷单", text: "### 超期缺陷单\n\n> 当前有 **3** 个缺陷需要继续关注。\n\n数据为演示内容，不会发送到真实钉钉群。", mobiles: [], defectIds: ["90004", "90005", "90006"], trigger: "manual", ok: true, dryRun: true, atAll: false, error: "", createdAt: dateTime(-1, 16, 35, 22) }
      ],
      accessLogs: [
        { id: "access-1", type: "page", owner: "匿名访问", ip: "203.0.113.18", path: "/guest", accessedAt: dateTime(0, 15, 12, 8), durationMs: 248000, sessionStatus: "ended" },
        { id: "access-2", type: "page", owner: "刘水生", ip: "198.51.100.23", path: "/guest/liuss", accessedAt: dateTime(0, 14, 38, 41), durationMs: 526000, sessionStatus: "ended" },
        { id: "access-3", type: "page", owner: "王思鑫", ip: "192.0.2.35", path: "/guest/wangsixin", accessedAt: dateTime(-1, 17, 6, 14), durationMs: 183000, sessionStatus: "ended" }
      ],
      operationLogs: [
        { id: "operation-1", operator: "管理员", ip: "203.0.113.10", action: "标记置顶", detail: "#90001", path: "/", operatedAt: dateTime(0, 16, 20, 16) },
        { id: "operation-2", operator: "刘水生", ip: "198.51.100.23", action: "标记修复难度", detail: "#90001 困难", path: "/guest/liuss", operatedAt: dateTime(0, 15, 42, 9) },
        { id: "operation-3", operator: "管理员", ip: "203.0.113.10", action: "标记为需求", detail: "#90005", path: "/", operatedAt: dateTime(-1, 18, 5, 30) }
      ],
      syncLogs: [
        { id: "sync-1", type: "FETCH_DEFECTS", trigger: "schedule", source: "demo", startedAt: dateTime(0, 16, 0, 0), finishedAt: dateTime(0, 16, 0, 3), count: defects.length, listCount: defects.length, detailCount: defects.length, syncMode: "incremental", addedAssignees: [], durationMs: 3280, ok: true },
        { id: "sync-2", type: "FETCH_DEFECTS", trigger: "manual", source: "demo", startedAt: dateTime(-1, 10, 20, 0), finishedAt: dateTime(-1, 10, 20, 6), count: defects.length, listCount: defects.length, detailCount: defects.length, syncMode: "full", addedAssignees: [], durationMs: 6140, ok: true }
      ],
      lastFetchAt: dateTime(0, 16, 0, 3)
    };
  }

  function createDemoConfig() {
    return {
      zentao: { enabled: false, baseUrl: "https://demo.example.com/zentao", account: "demo_user", password: "", cookie: "", projectId: 1001, productIds: [101, 102] },
      dingtalk: { webhook: "", secret: "", dryRun: true, atAll: true },
      rules: { statuses: ["active", "resolved", "closed"], priorities: ["1", "2", "3", "4"], urgentPriorities: ["1", "2"], assignees: [...assignees] },
      userMappings: {},
      scheduler: { enabled: true, fetchEveryMinutes: 5, p1p2ReportTimes: ["14:00", "18:00"], rules: { p1p2: true } },
      auth: { adminToken: ADMIN_PASSWORD }
    };
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored?.defects?.length) return stored;
    } catch {
      // Invalid demo storage falls back to a fresh seed.
    }
    const seeded = createSeedState();
    saveState(seeded);
    return seeded;
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function isToday(value) {
    return String(value || "").slice(0, 10) === dateTime().slice(0, 10);
  }

  function isOpen(item) {
    return !["resolved", "closed"].includes(String(item.status || "").toLowerCase());
  }

  function matchesOwner(item, owner) {
    if (!owner) return true;
    const name = assignees.find((itemName) => itemName === owner || aliases[itemName] === owner) || owner;
    return [item.assignedTo, item.assignedFrom, item.resolvedBy, item.initialAssignedTo, item.transferFrom, item.transferTo].includes(name);
  }

  function ownerStats(defects, name) {
    const related = defects.filter((item) => matchesOwner(item, name));
    const open = related.filter(isOpen);
    return {
      name,
      account: aliases[name] || name,
      openTotal: open.length,
      urgentOpen: open.filter((item) => ["1", "2"].includes(item.priority)).length,
      normalOpen: open.filter((item) => !["1", "2"].includes(item.priority)).length,
      pendingTest: related.filter((item) => item.status === "resolved" && item.assignedTo === "陈加鹏").length,
      todayAdded: related.filter((item) => isToday(item.openedDate) && item.initialAssignedTo === name).length,
      todayTransferred: related.filter((item) => isToday(item.transferAt) && item.transferFrom === name && item.transferStatusAfter !== "resolved").length,
      todayReturned: related.filter((item) => isToday(item.transferAt) && item.transferTo === name).length,
      todayResolved: related.filter((item) => isToday(item.resolvedDate) && item.resolvedBy === name).length
    };
  }

  function buildOverview(state, owner) {
    const defects = state.defects.filter((item) => matchesOwner(item, owner));
    const open = defects.filter(isOpen);
    const urgentOpen = open.filter((item) => ["1", "2"].includes(item.priority));
    const normalOpen = open.filter((item) => !["1", "2"].includes(item.priority));
    const resolvedPendingVerify = defects.filter((item) => item.status === "resolved" && item.assignedTo === "陈加鹏");
    const todayResolved = defects.filter((item) => isToday(item.resolvedDate));
    const todayClosed = defects.filter((item) => isToday(item.closedDate));
    const todayAdded = defects.filter((item) => isToday(item.openedDate));
    return {
      stats: {
        todayAdded: todayAdded.length,
        todayResolved: todayResolved.length,
        todayClosed: todayClosed.length,
        openTotal: open.length,
        urgentOpen: urgentOpen.length,
        normalOpen: normalOpen.length,
        abnormalOpen: 0,
        resolvedPendingVerify: resolvedPendingVerify.length
      },
      urgentOpen,
      normalOpen,
      abnormalOpen: [],
      todayPendingTest: todayResolved,
      todayClosed,
      resolvedPendingVerify,
      owners: (owner ? assignees.filter((name) => name === owner || aliases[name] === owner) : assignees).map((name) => ownerStats(state.defects, name)),
      recentLogs: state.pushLogs.slice(0, 5),
      lastJobRuns: state.syncLogs.slice(0, 5)
    };
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  async function requestBody(init) {
    if (!init?.body) return {};
    try {
      return JSON.parse(init.body);
    } catch {
      return {};
    }
  }

  function addSyncLog(state, trigger = "manual") {
    const startedAt = now();
    const log = { id: randomId(), type: "FETCH_DEFECTS", trigger, source: "demo", startedAt, finishedAt: startedAt, count: state.defects.length, listCount: state.defects.length, detailCount: state.defects.length, syncMode: "incremental", addedAssignees: [], durationMs: 860, ok: true };
    state.syncLogs.unshift(log);
    state.lastFetchAt = startedAt;
    saveState(state);
    return log;
  }

  function addPushLog(state, type) {
    const overdue = type === "OVERDUE_DEFECT_REPORT";
    const ids = overdue ? ["90004", "90005", "90006"] : ["90001", "90002", "90003", "90011"];
    const title = overdue ? "超期缺陷单" : "今日 P1/P2 缺陷风险提醒";
    const log = { id: randomId(), type, title, text: `### ${title}\n\n> 本次模拟推送包含 **${ids.length}** 条演示缺陷。\n\n> 演示环境不会连接或发送到真实钉钉群。`, mobiles: [], defectIds: ids, trigger: "manual", ok: true, dryRun: true, atAll: state.config.dingtalk.atAll, error: "", createdAt: now() };
    state.pushLogs.unshift(log);
    saveState(state);
    return log;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function demoFetch(input, init = {}) {
    const requestUrl = typeof input === "string" ? input : input.url;
    const url = new URL(requestUrl, window.location.href);
    if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);

    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const method = String(init.method || "GET").toUpperCase();
    const state = loadState();
    const owner = url.searchParams.get("owner") || "";

    if (url.pathname === "/api/session") return json({ authenticated: sessionStorage.getItem(AUTH_KEY) === "1" });
    if (url.pathname === "/api/login" && method === "POST") {
      const body = await requestBody(init);
      if (String(body.password || "") !== ADMIN_PASSWORD) return json({ ok: false, error: "Unauthorized", message: "演示口令不正确" }, 401);
      sessionStorage.setItem(AUTH_KEY, "1");
      return json({ ok: true });
    }
    if (url.pathname === "/api/logout" && method === "POST") {
      sessionStorage.removeItem(AUTH_KEY);
      return json({ ok: true });
    }

    if (url.pathname === "/api/overview") return json(buildOverview(state, owner));
    if (url.pathname === "/api/defects") return json({ defects: state.defects.filter((item) => matchesOwner(item, owner)) });
    if (url.pathname === "/api/assignees") return json({ assignees: [...assignees] });
    if (url.pathname === "/api/push-logs") return json({ logs: state.pushLogs });
    if (url.pathname === "/api/access-logs") return json({ logs: state.accessLogs });
    if (url.pathname === "/api/operation-logs") return json({ logs: state.operationLogs });
    if (url.pathname === "/api/sync-logs") return json({ logs: state.syncLogs });
    if (url.pathname === "/api/config-status") return json({ zentaoEnabled: false, dingtalkDryRun: true, dingtalkAtAll: state.config.dingtalk.atAll, hasDingWebhook: false, schedulerEnabled: state.config.scheduler.enabled !== false, schedulerRules: state.config.scheduler.rules, lastFetchAt: state.lastFetchAt, fetching: false });
    if (url.pathname === "/api/public-config") return json({ config: { rules: { assignees: [...assignees] }, guestAccessAccounts: Object.values(aliases) } });
    if (url.pathname === "/api/config" && method === "GET") return json({ config: state.config });

    if (url.pathname === "/api/overview-pins") {
      if (method === "PUT") state.pins = (await requestBody(init)).pinned || [];
      saveState(state);
      return json({ ok: true, pinned: state.pins });
    }
    if (url.pathname === "/api/overview-requirements") {
      if (method === "PUT") state.requirements = (await requestBody(init)).requirements || [];
      saveState(state);
      return json({ ok: true, requirements: state.requirements });
    }
    if (url.pathname === "/api/overview-difficulties") {
      if (method === "PUT") state.difficulties = (await requestBody(init)).difficulties || {};
      saveState(state);
      return json({ ok: true, difficulties: state.difficulties });
    }

    if (url.pathname === "/api/config" && method === "PUT") {
      const body = await requestBody(init);
      state.config = { ...state.config, ...(body.config || body) };
      state.config.zentao = { ...state.config.zentao, enabled: false, password: "", cookie: "" };
      state.config.dingtalk = { ...state.config.dingtalk, webhook: "", secret: "", dryRun: true };
      state.config.auth = { adminToken: ADMIN_PASSWORD };
      saveState(state);
      return json({ ok: true, config: state.config });
    }

    if (url.pathname === "/api/scheduler/enabled" && method === "PATCH") {
      state.config.scheduler.enabled = Boolean((await requestBody(init)).enabled);
      saveState(state);
      return json({ ok: true, scheduler: state.config.scheduler });
    }
    if (url.pathname === "/api/scheduler/rule" && method === "PATCH") {
      const body = await requestBody(init);
      state.config.scheduler.rules[body.rule] = Boolean(body.enabled);
      saveState(state);
      return json({ ok: true, scheduler: state.config.scheduler });
    }
    if (url.pathname === "/api/actions/fetch" && method === "POST") {
      addSyncLog(state);
      return json({ ok: true, source: "demo", count: state.defects.length, detailCount: state.defects.length, syncMode: "incremental", demo: true });
    }
    if (url.pathname === "/api/actions/push/p1p2" && method === "POST") return json({ ok: true, dryRun: true, demo: true, log: addPushLog(state, "TODAY_P1P2_RISK_REPORT") });
    if (url.pathname === "/api/actions/push/overdue" && method === "POST") return json({ ok: true, dryRun: true, demo: true, log: addPushLog(state, "OVERDUE_DEFECT_REPORT") });
    if (url.pathname === "/api/guest-passwords/reset" && method === "POST") return json({ ok: true, demo: true });
    if (url.pathname === "/api/operation-log" && method === "POST") {
      const body = await requestBody(init);
      state.operationLogs.unshift({ id: randomId(), operator: "管理员", ip: "浏览器本地", action: body.action || "页面操作", detail: body.detail || "", path: body.path || "/", operatedAt: now() });
      saveState(state);
      return json({ ok: true });
    }
    if (url.pathname === "/api/access-log/visit" && method === "POST") return json({ ok: true, ignored: true, demo: true });

    return json({ ok: false, error: "Demo API not found", message: `演示接口不存在：${url.pathname}` }, 404);
  };
})();
