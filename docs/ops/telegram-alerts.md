# 报警上手机:Telegram bot(两分钟)

**做完这份文档,钱路出事时你的手机会响。** 只需要你在 Telegram 里点几下,拿到两串字符,
填进 Railway 的两个变量。全程不需要写代码,也不需要付钱。

不做也没关系:两个变量不填,报警照样进 Sentry 和 tools@belcort.com 的邮箱,
只是不会在手机上弹出来。

---

## 你会拿到两串东西

| 东西 | 长什么样 | 从哪来 |
| --- | --- | --- |
| bot token | `8123456789:AAH_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | BotFather 发给你 |
| chat id | 私聊是正数 `123456789`;群是负数 `-1001234567890` | 下面第 3 步查出来 |

> token 就是这个 bot 的钥匙。**别贴进聊天、issue 或截图**。贴错了就回到 BotFather 发
> `/revoke`,换一条新的。

---

## 第 1 步 · 建一个 bot(约 40 秒)

1. 在 Telegram 搜索 **@BotFather**(带蓝色官方勾),点进去按 **Start**。
2. 发送 `/newbot`。
3. 它问名字(显示名,随便取,例如 `Fikirtive Alerts`)。
4. 它问用户名,**必须以 `bot` 结尾**,而且全网唯一,例如 `fikirtive_alerts_bot`。
   被占用就换一个,例如 `fikirtive_ops_bot`。
5. 它回一段话,里面那行
   `Use this token to access the HTTP API:` 底下就是 **bot token**。复制它。

---

## 第 2 步 · 让 bot 能给你发消息(约 30 秒)

Telegram 的规矩:**bot 不能主动私信一个从没跟它说过话的人**。所以必须先由你开口。

**选 A:私聊(只有你一个人收)**
在 BotFather 那段话里点自己 bot 的链接(`t.me/你的_bot`),按 **Start**,
再随便发一句 `hello`。

**选 B:群(你和以后的同事一起收 —— 推荐)**
1. 新建一个群,例如「Fikirtive 报警」。
2. 把你的 bot 加进群(群设置 → Add members → 搜它的用户名)。
3. 在群里随便发一句 `hello`。

---

## 第 3 步 · 取 chat id(约 30 秒)

把下面这行里的 `<TOKEN>` 换成第 1 步的 token,整行粘进终端跑:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

在输出里找 `"chat":{"id":...}`,那个数字就是 **chat id**。

```json
{"ok":true,"result":[{"message":{"chat":{"id":-1001234567890,"title":"Fikirtive 报警","type":"supergroup"}}}]}
                                                    ↑ 这个
```

- 私聊的 id 是正数,群的是**负数**(负号是 id 的一部分,别丢掉)。
- 如果 `result` 是空数组 `[]`,就是第 2 步那句话没发出去,或者发得太久以前了
  (Telegram 只保留最近 24 小时)。回去再发一句,重跑这条命令。
- 群里有多条消息时会有多个 `chat` 块,取 `"type":"group"` 或 `"supergroup"` 的那个。

---

## 第 4 步 · 填进 Railway(约 20 秒)

Railway → 项目 → **web** 服务 → Variables,加两条;然后在 **worker** 服务再加同样两条。

| 变量名 | 值 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 第 1 步的 token |
| `TELEGRAM_ALERT_CHAT_ID` | 第 3 步的 chat id |

两个服务都要填:一半的钱路报警来自 web(Stripe 付款),另一半来自 worker(生成作业)。
只填一个服务,另一半的报警就只有邮件和 Sentry。

填完让两个服务各重启一次(改变量通常会自动重启)。

---

## 第 5 步 · 证明它真的会响

不要靠「变量填了」就当接通了。跑一次真实发送:

```bash
curl -s -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d chat_id="<CHAT_ID>" -d text="Fikirtive alert channel test"
```

手机上收到这条,才算接通。`"ok":false` 的常见原因:

| 回应里的 description | 意思 | 怎么修 |
| --- | --- | --- |
| `chat not found` | chat id 抄错了,或漏了负号 | 重跑第 3 步 |
| `bot was blocked by the user` | 你把它拉黑了 | 在私聊里解除拉黑 |
| `Unauthorized` | token 错了或已被 revoke | 回 BotFather 用 `/token` 重取 |

---

## 它会在什么时候响

只在**需要人来决定**的钱路事故上响,不是每条错误都响。今天有两类:

- **商家付了钱什么都没拿到**(`gen.paid_for_nothing`)—— 一趟生成收了钱、零产出,
  而且钱已经结算,系统故意不自动退(自动翻成失败会在界面上许下一句「你没被扣钱」的假话)。
  要不要退,是你的决定。
- **有人付了钱,但我们不知道该给谁**(`stripe.paid_session_unusable_metadata`)——
  Stripe 说付款成功,但订单信息坏掉,credits 发不出去。要人工去 Stripe 后台找到买家补发。

每条消息里都带着 org、金额、作业 id —— 够你直接去后台找到那一单,不用先问工程。

---

## 相关

- 报警管道本身:`packages/core/src/founder-alert.ts`
- Sentry 侧的告警规则(邮件/通知路由):`docs/ops/dashboards.md` 第三节
- 监控整体分工:`docs/ops/incident-visibility.md`
