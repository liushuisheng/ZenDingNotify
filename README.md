# ZenDing Notify

禅道缺陷抓取、钉钉群提醒和本地可视化总览 MVP。

## 功能

- 定时抓取禅道指定规则缺陷数据，并推送到钉钉群，自动 @ 对应处理人
- 每天 09:40 推送前一天缺陷处理日报
- 每天 18:00 推送当天剩余 P1/P2 缺陷风险提醒
- 本地 Web 总览当天缺陷处理情况
- 查看推送记录
- 手动触发三类推送
- 未配置真实禅道/钉钉时，使用示例缺陷数据和 dry-run 推送，方便先验收流程

## 启动

```bash
npm start
```

### 本地前端连接线上后端

项目根目录的 `.env` 可配置本地 API 代理：

```dotenv
API_BASE_URL=http://42.194.169.35
```

配置后，本地浏览器仍访问 `http://localhost:8787`，所有 `/api/*` 请求由本地 Node 服务转发到该线上服务器。登录 Cookie 会保留在本地域名下，不需要额外配置 CORS。代理模式不会启动本地定时任务，避免与线上服务重复抓取或推送。

`.env` 只用于本机且已被 Git 忽略；仓库通过 `.env.example` 提供配置格式。修改 `.env` 后需要重启本地服务。

排查线上或本地运行问题时，可以通过 `npm start` 参数开启服务日志。若服务已经在运行，先停止当前进程，再用带参数的命令重新启动：

```bash
# 记录 API 请求、耗时和错误
npm start -- --log=info

# 额外记录禅道/钉钉外部请求状态，敏感 URL 参数会自动打码
npm start -- --log=debug
```

也可以使用简写：

```bash
npm start -- --debug
```

启动后在浏览器触发对应操作，例如手动推送 P1/P2：

```text
POST http://localhost:8787/api/actions/push/p1p2
```

终端会输出请求和外部调用日志，例如：

```text
[info] logging enabled: debug
[info] request:start {"method":"POST","path":"/api/actions/push/p1p2"}
[debug] external:start {"label":"dingtalk:markdown","method":"POST","url":"https://oapi.dingtalk.com/robot/send?access_token=***"}
[debug] external:end {"label":"dingtalk:markdown","status":200,"durationMs":320}
[info] request:end {"status":200,"durationMs":450}
```

然后打开：

```text
http://localhost:8787
```

## 配置

首次启动会自动生成：

```text
data/config.json
data/store.json
```

核心配置示例：

```json
{
  "zentao": {
    "baseUrl": "https://zentao.example.com",
    "account": "bot",
    "password": "password",
    "cookie": "",
    "projectId": 2635,
    "productIds": [1],
    "enabled": false
  },
  "dingtalk": {
    "webhook": "",
    "secret": "",
    "dryRun": true
  },
  "rules": {
    "statuses": ["active", "changing"],
    "priorities": ["0", "1", "2", "3", "4"],
    "urgentPriorities": ["1", "2"],
    "assignees": []
  },
  "userMappings": {
    "zhangsan": {
      "name": "张三",
      "mobile": "13800000000"
    }
  }
}
```

将 `zentao.enabled` 改为 `true` 并配置禅道地址账号后，会从禅道 REST API 抓取数据。

将 `dingtalk.dryRun` 改为 `false` 并配置钉钉机器人 `webhook`，才会真实发送群消息。启用加签时填写 `secret`。

## API

- `GET /api/overview`
- `GET /api/defects`
- `GET /api/push-logs`
- `POST /api/actions/fetch`
- `POST /api/actions/push/rule`
- `POST /api/actions/push/yesterday`
- `POST /api/actions/push/p1p2`
