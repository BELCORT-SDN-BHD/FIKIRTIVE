# 本地质量检查

GitHub 与本地使用同一个质量入口：

```bash
pnpm install --frozen-lockfile
pnpm quality
```

`pnpm quality` 会依次验证 package build、数据库 migration 与 schema 漂移、测试、
TypeScript、lint、Otto skill 边界、资金毛利不变量、破坏性 migration，以及 Next.js
production build。任一步失败，整项质量检查失败。

## 本地数据库

本机需有可连接的 PostgreSQL 16。默认连接为：

```text
postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test
```

脚本拒绝基础数据库名不以 `_test` 结尾的连接；本地运行时，它还会建立一个独立的
临时测试库，并在结束时删除。要使用另一台测试数据库，可传入安全的 `DATABASE_URL`。
若为了诊断而要保留本次临时数据库，设置 `FIKIRTIVE_KEEP_TEST_DB=1`。

## GitHub 上的形态

Draft PR 不运行这项较重检查。PR 转为 Ready 后，GitHub 把同一批闸拆成五条**并行**的
腿，每条腿一台独立机器：

```text
quality.sh --leg typecheck | --leg tests | --leg build | --leg lint | --leg checks
```

五条腿之上是一个名为 `quality` 的扇入 job，它仍然是**唯一的 required check**：五条
腿全绿它才绿，任何一条失败、被取消或状态不明，它一律判失败。墙钟因此从「所有闸相加」
变成「最慢的一条腿」。

「五条腿全绿它才绿」有一个既有的例外，而且只有这一个：**可证明只改了 `docs/**` 的
PR**。那种 PR 上五条腿全部 `skipped`，扇入按 `skipped` 判合法通过（`ci.yml` 的
「scope 说 code=false → 每条腿都必须是 skipped」那一支）。这一支同样是严格相等：
真是 docs-only 却有一条腿跑了，照样判失败——腿和扇入对「这次运行是什么」没谈拢，
说不清的运行不许合。

**而这一支从 r11 起不再只听 scope 的**。r10 复审实测了它原本的代价：scope job 是靠
跑仓库里的 `bash scripts/ci/pr-scope.sh` 得出答案的，把那一个脚本改成输出 `false`
——ci.yml 一个字没动、锁文件一个字没动——五条腿全被跳过，扇入把这一整组 skipped 读
成「docs-only PR」，required 的 `quality` 就绿了，而一道闸都没跑。

所以扇入现在**自己再判一次**：在它自己那个 job 里，用同样两个 API 响应，跑一段
**写在 ci.yml 里**的 jq（不是再调一次 `pr-scope.jq`——同一段程序对同一份数据当然会
同意自己，那正是 r10 抓到的形状）。两个答案的比对是**单向**的，这是设计不是疏漏：

| scope 说 | 扇入自己判 | 结果 |
| --- | --- | --- |
| docs-only（腿已跳过） | 不同意 | **红**：腿是按一个扇入复现不出来的答案跳掉的 |
| docs-only（腿已跳过） | 同意 | 绿（这就是 docs-only 短路本身） |
| 跑全部闸（腿都跑了） | 说 docs-only | 腿**跑了**，没有没跑的闸可藏 → 按腿的结果判 |

第三行不判红是有原因的：scope 遇到 API 读不出来时的 fail-closed 分支本来就答「跑全部
闸」，把这一行判红等于让每一次 API 抖动都堵死合并，而它一个闸都没少跑。

一句话：**`pr-scope.sh` / `pr-scope.jq` 撒谎，现在最多只能让 CI 白跑 13 分钟，买不到
一次跳过。** 扇入那段重判逻辑本身也是 ci.yml 里的几十行（见下节），这里不声称它是自闭环。

本地不需要分腿：不带参数的 `pnpm quality` 依旧按上面的顺序跑完全部闸，一个不少。要
在本地复现某一条腿（例如 CI 只有 `tests` 红），可以跑 `pnpm quality --leg tests`。

哪个闸属于哪条腿，写在 `scripts/ci/quality.sh` 每个 `gate` 的第一个参数上；
`scripts/__tests__/quality-legs.test.sh` 会机器校验「所有腿的并集 = 全部闸」与
「ci.yml 跑的腿名 = quality.sh 声明的腿名」，它本身也是一道闸。它手写一份独立的
「闸 → 腿」清单当真值：增删闸、改闸名、把闸挪到别的腿，都必须在同一个 commit 里
改那份清单，否则这道闸红。它读 ci.yml 时按 YAML 语义解析（用本机已有的 PyYAML /
ruby / yq / js-yaml 任一），注释里的腿名和接线一律不算数——被注释掉的闸不会跑。

它还校验「这条腿真的会跑，而且跑挂了会传出去」，因为「文件里写着这条命令」不等于
「这条命令执行了」：每条腿的 `run` **整段脚本**必须一字不差是
`pnpm quality --leg <腿名>`（多一个 `|| true`、或者被 `if false; then … fi` 包起来，
这条腿就再也红不起来）；`package.json` 里 `quality` 这条 script 也必须一字不差是
`bash scripts/ci/quality.sh`（`pnpm quality` 最终跑的是它）；每个 job 的 `if:` 必须
和自测里手写的条件逐字相同（job 没跑报的是 `skipped`，不是 `failure`）；任何 step
都不许带 `if`、`continue-on-error`、`shell`、`working-directory`，任何 job 都不许带
`continue-on-error`、`strategy`、`defaults`。（`shell` 只有一个例外，而且它是**要求**
不是缺口：每个 job 第 2 步那道绊线必须写 `shell: sh`，理由见下面「为什么这一步写着
`shell: sh`」。别的 step 带 `shell:`、或者绊线写成别的值，照样红。）

腿**运行时的环境变量**也逐字钉死，而且是白名单：workflow 级 `env:` 的键值集必须与
自测里手写的那份一模一样（多一个、少一个、改一个值，都红），job 级 `env:` 一律不许
有，step 级 `env:` 只许是自测里列出的那几条。它挡的是「命令一个字没改，却什么都没
跑」——在 workflow `env:` 里加一行 `npm_config_script_shell: /bin/echo`，
`pnpm quality --leg lint` 就只把自己那条命令回显一遍然后退出 0，五条腿全绿、
required check 也绿，而一道闸都没跑。写成白名单而不是「坏名字清单」，是因为
`PATH`、`BASH_ENV`、`NODE_OPTIONS` 的 `--require`、以及 `npm_config_*` / `PNPM_*`
两族都能做同一件事，pnpm、node、bash 下一个版本还可能再加一个没人听说过的。

所以在 ci.yml 里新增 job、改 job 的 `if:`、动任何一个环境变量，同样要在同一个
commit 里改那份手写清单。

上面这些都是**诊断层**。真正的判决是另一条：自测把 ci.yml 整份解析后做**规范化序列
化**（所有键排序、固定格式、step 顺序照原样），与自测文件里手写的字面量**逐字节**比
对。原因是那些清单都按「面」枚举，而 #874 前五轮每一轮都被找出一个清单没枚举到的新
面——r5 那两个是：安装步用 `>> $GITHUB_ENV` 把 `npm_config_script_shell` 交给下一步
（腿自己的命令一个字没改），以及 job 上的 `container: { image, env }`（job 级 `env:`
刚被禁掉，换个键照样进到该 job 每一个 step 里）。整体比对不按「面」工作，所以也不会被
「谁都没想到的那个面」绕过：`container`、`uses` 的版本、`with`、`services.postgres.env`、
多一个 step、两个 step 对调、任何一段 `run` 改一个字符，都是不同的字节。

有一个例外值得写下来，因为 r6 复审就是从这里进来的：YAML 1.1 会把顶层 `on:` 这个**键**
读成布尔 true，所以比对前有一次归一化。复审把 `on:` 换成 `"true":`，三个解析器读出来
一模一样、规范化字节也没变，而 GitHub 只认 `on`。归一化天然分不出这两者——「把它们合成
一个」正是归一化的定义。所以现在**先看原始字节**：顶层必须正好有一行 `on:`，并且不许有
别的拼成 YAML 1.1 布尔值的顶层键。

代价是：**改 ci.yml 就一定红，直到在同一个 commit 里重新生成那段字面量**——这正是设
计意图，让每一次 workflow 改动都变成一份人能读、评审能签的 diff。重新生成：

```bash
QUALITY_LEGS_PRINT_CANONICAL=1 bash scripts/__tests__/quality-legs.test.sh
```

把打印出来的两段贴回自测文件里对应的标记之间（这个开关只负责打印，打印完照样把每一条
检查跑完，永远不能拿它绕过比对）。**贴之前先看 diff**：闭着眼睛重新生成，等于亲手把这
道闸关掉。

扇入 job 的判决脚本不只被读，还会被自测**真跑一遍**：把它从 ci.yml 里解析出来，用五条腿
各种非绿组合喂进去，验证它确实判失败。只读文件只能证明比较写在那里，跑一遍才能证明
比较被执行到。r11 起这一组还包含 r10 那个 P0 的原形：**scope 说 docs-only、五条腿全跳、
而扇入自己重判不同意 → 必须红**；重判没答话（空、乱码、`skipped`）同样必须红——那一步是
前提，不是客气。

扇入那一步重判本身，也像绊线一样在自测里**手写复述一遍**（3g）：整段脚本逐字节、`id`、
步骤位置都钉死，还额外要求它**不许提到 `pr-scope`**——再调一次同一个脚本就不叫第二意见。
另外 3h 会核对「ci.yml 点名的 `scripts/…` 路径」= 自测里手写的那份名单（见下面「改 CI 的
diff，先读这几个文件」）——它证明的是「这份 workflow 会跑的仓库脚本」这一个集合完整，
不是「能拦住闸的文件」都在名单上。

## 这道闸自己会不会被关掉

会。而且这不是「再补一道检查」能堵上的洞，所以把边界写清楚比多写一道检查有用。

上面所有检查都跑在 `pnpm quality --leg typecheck` 里面——七个 job 中的一个，而且排在那
个 job 的安装步之后。r6 复审给出的做法是：在 typecheck 的**安装步**里写一行
`npm_config_script_shell=/bin/echo >> $GITHUB_ENV`，下一步的 `pnpm quality` 就只把自己
那条命令回显一遍、退出 0——自测根本没启动，逐字节比对没有意见（因为它没跑），扇入收到
`typecheck: success`。**判官装在它要检查的那台机器里，就能跟那台机器一起被关掉**，这是
自测这种东西的结构性事实，不是多写一条检查能修的缺陷。

所以接住这一手的东西不在自测里，在 ci.yml 里：**每个 job 的第 2 步**——checkout 之后、
任何 setup / install / `$GITHUB_ENV` 写入之前——重新算一遍 ci.yml 的 sha256，跟仓库里
committed 的 `.github/ci-workflow.lock` 比。它只用 `cut`、`sha256sum` 和 shell 内建，
不碰 pnpm、node、python。

同一步还按文件名拒绝两个文件：`.npmrc` 与 `.pnpmfile.cjs`（r13 新增，起因是 r12 的实测
——项目级 `.npmrc` 里一行 `script-shell=/bin/echo` 就能让五条腿全部空跑）。它写在**绊线**
里而不是写在自测里，理由正是本节这条递归：那个 `.npmrc` 一旦存在，`pnpm quality` 压根不会
启动，自测也就没机会说话；绊线跑在 pnpm 被调用之前。这是**棘轮不是边界**——它关掉一个已被
演示的载体，并且让将来合法引入 `.npmrc` 这件事没法悄悄发生（作者要么在同一个 commit 里改
绊线和自测里那份手写副本，要么让七个 job 全红）。

**依赖要说准**（不能写成「这一步什么都不依赖」）：新增的这个**文件拒绝循环只用 shell 内建**
（`for`、`[`、`echo`）；但**绊线整步**仍然要用 `cut` 与 `sha256sum` 这两个外部命令来算指纹。
它们缺失、或者被 PATH 换掉时，`set -eu` 让这一步直接非零退出、job 变红——**fail-closed**，
不会静默放行。可以主张的是 fail-closed，不是「零外部命令」。

### 为什么这一步写着 `shell: sh`

因为 r8 复审证明：**正文再干净也没用，如果它还没开始跑就已经输了**。

GitHub 的 `run:` 默认交给 bash（没写 `shell:` 时是 `bash -e {0}`，写 `shell: bash` 时是
`bash --noprofile --norc -eo pipefail {0}`）。bash 启动时会先 source 环境变量 `BASH_ENV`
指的那个文件，**早于正文第一行**——两种形态都读，实测过。于是在 workflow 级 `env:` 里加一
行 `BASH_ENV: <路径>` 就够了：
那个文件可以直接把 `.github/ci-workflow.lock` 重写成当前 ci.yml 的指纹（仓库自带的
`scripts/ci/ci-workflow-lock.sh` 正好就干这件事），也可以定义两个叫 `cut` 和 `sha256sum`
的函数，让比对结果等于任何想要的值。绊线的 diff 一个字没动，锁文件一个字没动。

非交互的 `sh` **既不读 `BASH_ENV` 也不读 `ENV`**（runner 上是 dash，本机是 bash 的 sh
模式，两边都实测过）。所以这一步显式声明 `shell: sh`，正文就跑在一个这份文件毒不到的
启动环境里。自测把两件事都钉死：绊线那一步的 `shell:` 字段必须正好是 `sh`；**整份
workflow 的任何一层 `env:`（含 `container.env`、`services.*.env`）都不许出现
`BASH_ENV` 或 `ENV`**。演习里还有一组用例是**真的把绊线正文跑起来**——同一段脚本、同一份
不匹配的锁，`sh` 必须拒绝、`bash` 必须被骗过。后半句不是 bug，是**钉子**：它保证将来没人
把 `shell: sh` 当噪音顺手删掉。

### 它买到什么，买不到什么

**它买到的**：让「真正跑起来的那份 workflow」可证明地等于「被复审过的那份」。只要 ci.yml
不是 `.github/ci-workflow.lock` 钉的那一份，每个 job 的第 2 步都会红——`scope` 先红，五条
腿因为 `needs: scope` 变成 skipped，**required 的 `quality` 检查红，PR 合不进去**。（不要
写成「七个 job 全红」：没启动的 job 报的是 `skipped` 不是 `failure`。）把某个 job 里的这
一步删掉或改废也在覆盖内，因为另外六个 job 照样算整份文件的指纹。

**它买不到的，写清楚**：它不是墙。这里前后写过三句「点名一个集合就够了」的话，三句都被
下一轮实测推翻，而且每次的反例都落在**上一轮那份名单之外**：

- r8 推翻了「绕过必然会动绊线那一步或者动锁文件」——workflow 级的 `BASH_ENV` 两样都没动；
- r10 推翻了它的替补「任何绕过都需要一个改 `.github/workflows/ci.yml` 的 diff」——而且是
  用实测推翻的：ci.yml **会跑仓库里的脚本**（`scope` 跑 `scripts/ci/pr-scope.sh`，而且是
  在绊线通过之后跑），改那一个脚本就能跳掉全部五条腿，ci.yml 与锁都不用碰。
  **workflow 不是唯一的可变面，workflow「跑的东西」也是。**
- r12 推翻了再下一个替补「改动必然落在这七个文件里」——**项目级 `.npmrc` 写一行
  `script-shell=/bin/echo`**，七个文件一个字没动，五条腿全部只打印自己的命令然后 exit 0，
  五个 success 喂给扇入，required 的 `quality` 变绿而一道闸都没跑。**pnpm 自己会读的东西，
  ci.yml 里根本没提过。**

### 绊线能证明什么，什么是这个仓库证明不了的

**能证明的（每次运行都由机器验）：**

1. **跑起来的那份 ci.yml 就是提交的那份**——每个 job 第 2 步的指纹比对，在任何 setup /
   install / `$GITHUB_ENV` 写入之前；
2. **已发现载体上的具名棘轮**：整份 workflow 任何一层 `env:` 都不许有 `BASH_ENV`/`ENV`
   （自测 3d）、绊线自己的 `shell: sh`（3f）、以及 r13 新增的
   **checkout 里不许存在 `.npmrc` 与 `.pnpmfile.cjs`**（绊线正文按文件名拒绝）；
3. 每条腿跑的正好是 `pnpm quality --leg <腿名>`，`package.json` 把它解析成
   `bash scripts/ci/quality.sh`，而 `quality.sh` 的「闸 → 腿」映射被自测里**手写**的清单
   双向比对（删闸、改名、换腿都红）；
4. docs-only 那个跳过结论由**扇入自己**用 API 重判一次，所以说谎的 `pr-scope` 只能让闸
   **多跑**，买不到一次跳过。

**证明不了的，而且是这个仓库里没有机制能证明的**：*「仓库里不存在其它能改变检查执行路径
的文件」*。`BASH_ENV`、`pr-scope.sh`、`.npmrc` 三次都在当时那份名单之外；载体是**开集**，
凡是宣称「集合之外拦不住任何一道闸」的句子，都已经被下一轮实测打过脸。

**所以，真正拦住「悄悄弱化 CI」的防线是且只是两条，两条都不是这个仓库里的脚本：**

1. protect-main ruleset 里那个名叫 `quality` 的 **required check**（bypass_actors 为空）；
2. **人审 PR diff**——上面每一种载体，以及还没被谁点过名的下一种载体，本质都是「改了一个
   文件」，而改文件必然出现在 diff 里。这是唯一一条不依赖「名单猜对了」的性质。

### 改 CI 的 diff，先读这几个文件

**这是复审的阅读顺序，不是边界，也不声称完整。**它们的共同点是：改它们会让闸**不跑**
（安静），而改闸本身只会让闸**变红**（吵闹）。右栏写的是改了之后什么会红：

| 文件 | 改了之后什么会红 |
| --- | --- |
| `.github/workflows/ci.yml` | 绊线（每个 job 第 2 步）+ 自测 3e 逐字节 |
| `.github/ci-workflow.lock` | 绊线 + 自测 3f 验锁是当前的 |
| `scripts/ci/pr-scope.sh` | **扇入自己重判**（3g 手写钉死那一步） |
| `scripts/ci/pr-scope.jq` | 同上 |
| `scripts/ci/quality.sh` | 自测 1./2. 手写的「闸 → 腿」清单（删闸、改名、换腿都红）※ |
| `package.json` | 自测 3b 把 `quality` 那条 script 逐字钉死 |
| `scripts/ci/ci-workflow-lock.sh` | **什么都不红**；workflow 不跑它，它只写锁 |
| `.npmrc`、`.pnpmfile.cjs` | 今天不存在；一出现，七个 job 的绊线全红，本机 `pnpm quality` 也在 3f(c) 红 |

※ 一个必须写明的例外，ci.yml 头部与自测头部都写了同一句（r12 抓到这三处以前互相矛盾）：
自测本身就是 `quality.sh` 里的一条 gate，所以**把那一行 gate 从 `quality.sh` 里删掉，就等
于把判官删掉**——绊线也接不住（它算的是 ci.yml 的指纹，不是 `quality.sh` 的），**CI 里没有
任何东西接得住**。接住它的只有 `quality.sh` 的 diff。

自测 3h 会把 ci.yml 里每一段 `run:` 提到的 `scripts/…` 路径扫出来，跟手写名单双向比对——
ci.yml 里多调一个没人点过名的脚本，这道闸就红。**读清楚它说的是什么**：它说的是「这份
workflow 会跑的仓库脚本」这个集合是完整的；它对「pnpm、node、runner 自己会去读什么」
一个字也没说，而 r12 的 `.npmrc` 正是从那儿来的。

`.npmrc` / `.pnpmfile.cjs` 那条是**棘轮，不是边界**：它关掉的是一个**已经被演示过**的载体
（r12），并且让将来**合法**引入 `.npmrc` 这件事没法悄悄发生——作者必须在同一个 commit 里改
ci.yml 的绊线（七份）和自测里那份手写副本，复审于是同时看到两半。它**不构成**「载体已经数
全了」的证据。

锁文件依然是可以重算的（`bash scripts/ci/ci-workflow-lock.sh`），所以铁了心的作者可以改
ci.yml、重算锁、重生成字面量，然后一路绿。这一直都是真的，现在它是演习里的一个用例而不
是一句承诺。扇入那段重判逻辑本身也是 ci.yml 里的几十行（被锁钉住、被自测 3g 手写复述一
遍）——**这里不声称它是自闭环**。
**这些东西是防未经复审的漂移的仪器，不是防铁了心的作者的墙——这个仓库里没有那种墙。**

改了 ci.yml 之后，同一个 commit 里要做两件事，顺序如下：

```bash
bash scripts/ci/ci-workflow-lock.sh                                        # 1. 重算锁
QUALITY_LEGS_PRINT_CANONICAL=1 bash scripts/__tests__/quality-legs.test.sh # 2. 重生成字面量
```

`pnpm quality` 在本机也会验锁是不是当前的，所以忘了第 1 步会在本地就红，不用等 push。

## 演习

`bash scripts/__tests__/quality-legs.drill.sh`（实测约 10 分钟）在临时目录里复制一份仓库，逐个
把 ci.yml 改坏——上面每一种形状都在内，**每次改坏都顺手把锁重算**，这样红的原因就一定是被
测的那道检查而不是锁过期——要求自测每一次都红。共 59 个 case，其中：

- r4/r5/r6 复审找出的每一种形状（不跑的 step、吃掉失败的 step、六种环境注入、
  `$GITHUB_ENV`、`container`、版本/`with`/加 step/换顺序/`services.postgres.env`）；
- **判官关自己那一组**：同样的注入打在 **typecheck** 腿上（此前每个 case 都打在自测不在
  的腿上，自测总是跑得成）、把绊线从 typecheck 删掉、把七个 job 的绊线一起改废——验证锁
  和手写期望各自都能接住；
- 锁本身：ci.yml 改了而锁没重算、锁被清空；
- 门：普通的合法改动（`pnpm/action-setup` 升版）+ 重新生成必须绿；改了并重新生成但没同步
  手写清单必须仍然红——job 级 `env:` 是一例，`actions/checkout` 升版是另一例（r7 起「第 1
  步必须是 checkout」也是手写钉死的一项，所以它要在两处各说一遍）；
- **r8 启动环境那两组**：
  - 写在 ci.yml 里的三种形状——workflow 级加 `BASH_ENV`、把七处 `shell: sh` 一起删掉、
    把 `BASH_ENV` 藏进 `container.env`——改坏之后连锁带字面量全部重生成，仍然必须红
    （分别由 3d 的 `BASH_ENV`/`ENV` 拒绝清单和 3f 钉死的 `shell:` 字段接住）。第三个
    是**只有拒绝清单接得住的那一个**：`container:` 不在禁用键里，`container.env` 也不在
    任何白名单里，字面量又已经重生成——其余每一条检查都会点头；
  - **真的把绊线正文跑起来那一组**（9 个 case，不经过自测）：把绊线脚本从 ci.yml 里取
    出来，配一份**不匹配**的锁，按 runner 的两种起法启动——`sh -e`（现在 ci.yml 声明的）
    和 `bash --noprofile --norc -eo pipefail`（bash 两种形态里更严的那一种；更松的
    `bash -e` 正是以前默认拿到的，同样中招）——分别喂三种毒：定义
    `cut`/`sha256sum` 的文件、同样内容走 `/dev/stdin`（磁盘上不留任何痕迹）、以及直接把
    `BASH_ENV` 指向仓库自己的 `scripts/ci/ci-workflow-lock.sh`（source 它就等于重写锁）。
    要求是**不对称**的：`sh` 必须拒绝，`bash` 必须被骗过。外加两个对照 case（干净环境下，
    锁不匹配必须红、锁匹配必须绿），否则「sh 拒绝了」什么也证明不了——一道永远红的闸也能
    拿满分。
- **r12「pnpm 自己会读的东西」那一组**（5 个 case，r13 加）：三个不经过自测——绊线正文
  配**匹配**的锁跑起来，分别放一个 `.npmrc`、一个 `.pnpmfile.cjs`，都必须拒绝；两个都不
  放时必须仍然接受（证明这条新拒绝是**有条件**的，不是「一律红」）。两个经过自测——把棘轮
  从七处绊线一起删掉 + 连锁带字面量全部重生成，3f 逐字节仍然必须红；本机 working tree 里
  出现 `.npmrc` 而绊线没动，3f(c) 必须红；
- **r10「另一个可变面」那两组**（12 个 case）：
  - **端到端那一组（9 个，同样不经过自测）**：把 `pr-scope.sh` 放进三种状态（仓库原样 /
    换成一行 `echo false` / `pr-scope.sh` 原封不动而把 `pr-scope.jq` 的 docs 判定放宽到
    接受一切），对同一对固定 API 响应问答案；同时**把扇入那一步从 ci.yml 里取出来真跑**
    （配一个只吐这两份 fixture 的 `gh` 桩），再把两边的答案喂给**同样从 ci.yml 取出来的**
    扇入判决脚本。要求：两种毒化下 `pr-scope.sh` 都确实吐出 `false`（证明这个绕过是真的），
    而扇入**必须红**；真正的 docs-only PR 照常全跳、照常绿。四个对照 case 打头，否则
    「毒化被拒了」同样什么都证明不了。
  - **写在 ci.yml 里的三种形状**：把重判改成一上来就答 docs-only、把重判 jq 的最后一支也
    改成 docs-only、把判决里 `if [ "$RECHECK_CODE" != "false" ]` 换成 `if false`——三个都
    连锁带字面量全部重生成，仍然必须红（前两个由 3g 手写钉死的重判脚本接住，第三个由 3b
    手写钉死的那一行比较接住）。
- 最后一个 case 是**故意绿的**：typecheck 被注入 + 锁重算 + 字面量重生成，自测和绊线都会
  放行。它要求的不是「红」，而是**「必须留下 `.github/workflows/ci.yml` 的 diff」**。把这
  一条写成 case 而不是写成一段话，是为了让它一直是真的。（r8 之前它还要求「锁文件也必须
  变」——r8 的绕过一个锁字节都没动，所以那条要求本身就是假的，已经删掉。）
  **它断言的范围就是它模拟的那一种绕过**：这个 case 的改动本身就是改 ci.yml，所以留下
  ci.yml diff 是它做得到的事。它**不**代表「每一种绕过都会留下 ci.yml diff」——那句话
  r10 已经用 `pr-scope.sh`、r12 已经用 `.npmrc` 各推翻过一次。「一切绕过都在 diff 里」
  这条仍然成立，但成立的理由是**改文件就会出现在 diff 里**，而不是因为改的是哪个文件。

不要把重复执行同一批闸的 job 或第二套本地命令再加回来。
