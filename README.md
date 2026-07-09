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
