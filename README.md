# hermes-channel

agent-autoloop 的通道插件：把卡片发到 `hermes send` 已经能发的地方——iMessage、微信、Telegram，以及 Hermes 配好的其他平台。不用再为这个通道单独申请账号，用的就是 Hermes 网关里已有的凭据。

只能发文字和一条链接，没有按钮。在规则里给这个通道写 `"links": true`，收到的人点链接就能回答那张卡片。

## 安装

```bash
agent-autoloop add https://github.com/Jeffgithub0029/hermes-channel
```

插件装到 `~/.agent-autoloop/plugins/hermes-channel/`，仓库名就是规则和配置里要写的名字。

## 配置

先看这台机器上 Hermes 能把信发到哪：

```bash
hermes send --list
```

`--to` 认的值有两种：光写平台（`telegram`、`weixin`、`photon`）表示该平台的主会话；写 `平台:会话` 就发到指定会话，例如 `telegram:-1001234567890`。

**rules.json**：登记通道，写清楚只能发文字，链接本身负责回答：

```json
{
  "channels": {
    "wechat": { "name": "微信", "links": true },
    "imessage": { "name": "iMessage", "links": true }
  }
}
```

**config.json**：每个通道一项，`target` 是上面 `--list` 打印的名字：

```json
{
  "channels": {
    "wechat": { "use": "hermes-channel", "target": "weixin", "key": "通道密钥" },
    "imessage": { "use": "hermes-channel", "target": "photon", "key": "通道密钥" }
  }
}
```

密钥用 `agent-autoloop key new channel wechat` 取。改完配置重启中台。

只让某几条规则发微信，就在这些规则上写 `"channels": ["wechat"]`（agent-autoloop #142 起支持）；不写就发到所有通道。

## 这个通道怎么做

- 新卡片发一条消息：标题作 `--subject`，正文写卡片文字、编号的选项和链接。
- 已经发出去又变了的卡片不重发。聊天里的消息改不了，所以只报告，不再发一条。
- 正文超过 3500 字截断并加省略号。各家聊天都有长度上限，发不出去不如发一部分。
- 发送失败上报中台，按中台规则重派；中台连不上时每 10 秒重试，不退出。
- `hermes` 通过登录 shell 找，和接单程序找 Agent 的方式一样；launchd 的 PATH 比人的短，直接 `spawn("hermes")` 会 `ENOENT`。也可以用 `program` 指定绝对路径。

## 用 `--file -` 读正文

`hermes send` 的位置参数优先于标准输入：写成 `hermes send --to telegram -` 时，正文就是那个 `-`，管道里的内容会被丢掉。要从标准输入读正文，必须写 `--file -`。插件就是这么调的；自己写脚本时容易踩这一条。

## 自检

```bash
node --test tests/
```

5 项：参数与正文、3500 字截断、已发卡片不重发、发送失败上报、没写 `target` 时的报错。用例用一个假 `hermes` 程序记录参数和标准输入，不连中台。

引擎侧的实际安装与发信验证另做：把本仓库 `agent-autoloop add` 进一个临时中台，配一个假 `hermes`，看它收到的参数和正文。

## 环境

- Node ≥ 24（插件用了 TypeScript 直接运行）。
- 本机装好 Hermes 并配好目标平台的凭据；`hermes send --to <目标> "测试"` 能发出去再装这个插件。
- 只在 macOS 上、配合作者自己在用的 Hermes 网关跑过。Hermes 的输出、退出码或参数变了，这里要跟着改——这也是它单独一个仓库、不放进内置插件的原因。
- `hermes send` 的退出码：0 成功，1 发送失败，2 用法错误。插件只按非 0 判失败，并把 stderr 记进卡片失败原因。

## 许可

MIT。
