# Pi Welcome

给 [Pi](https://pi.dev/) 加一个全屏启动页。从像素标志变成 π 的几秒里，就可以用方向键选中上次的对话，按 Enter 接着聊。图形全部由终端字符绘制，不需要图片协议或 Nerd Font。

![NVIDIA 黑绿配色的开场动画与会话切换](docs/media/welcome.gif)

## 安装与下载

已在 Pi 1.5.0 的交互模式下测试。推荐用 Pi 从 GitHub 安装固定版本：

```sh
pi install git:github.com/gcy-hub/pi-welcome@v1.0.0
```

重新启动 `pi` 即可看到欢迎页。若已打开 Pi，可先执行 `/reload`，再输入 `/welcome`。

**离线安装：** 下载 [pi-welcome-1.0.0.zip](https://github.com/gcy-hub/pi-welcome/releases/download/v1.0.0/pi-welcome-1.0.0.zip)，解压到准备长期保留的目录，再从其上一级运行：

```sh
unzip pi-welcome-1.0.0.zip
pi install ./pi-welcome-1.0.0
```

本地路径安装会直接使用解压目录，请保留它。若之前已手动安装到 `~/.pi/agent/extensions/pi-welcome/`，请只保留一种安装方式，避免重复注册命令。卸载 GitHub 版本：`pi remove git:github.com/gcy-hub/pi-welcome@v1.0.0`。

## 选择会话

![会话选择页：NVIDIA 黑绿](docs/media/sessions.png)

`/welcome` 或 `/pi-welcome` 可随时在空闲时打开欢迎页。会话按最近更新排序，优先显示 `/name` 设置的名称，否则显示首条消息。

| 按键 | 操作 |
|---|---|
| `↑` / `↓` | 移动直角高亮条。到首尾时循环选择，不轮转列表顺序 |
| `Enter` | 恢复选中的会话，或进入「+ 新建会话」 |
| `Esc` | 关闭欢迎页，保留当前会话 |

没有历史时不显示列表，`Enter` 和 `Esc` 都直接进入当前空白会话。通过 `--continue` 或 `--session` 启动时也会显示欢迎页；同一进程里切换会话或 `/reload` 不会重复弹出。

## 选择动画与配色

输入 `/pi-welcome themes`。当前动画播完后，左侧选择动画，中间选择配色，右侧循环预览。按 `Enter` 可以跳过开场。

![三栏主题选择：动画、NVIDIA 黑绿配色与实时预览](docs/media/themes.png)

用 `Tab` 或 `←` / `→` 切换列，`↑` / `↓` 试选。`Enter` 保存并重播新组合，随后进入会话选择；`Esc` 取消本次修改。设置保存在 Pi 配置目录的 `pi-welcome.json`，不会修改聊天界面或终端的全局主题。

可自由组合 **8 个开场动画和 14 套配色**。默认是「粒子聚合 × 原始蓝紫」，图中使用「粒子聚合 × NVIDIA 黑绿」。另有纸白荧紫等浅色方案；[配色表与色卡](assets/Color/)列出了 13 套素材配色的 RGB 值，原始蓝紫随终端背景自适应。

## 开发

Pi 包入口为 `index.ts`。播放只读取 `assets/animations.json.gz` 和 `assets/Color/*.md`，不需要 Python。源 GIF 存在 `assets/Anime/`；修改它们后，用安装了 Pillow 的 Python 运行 `python3 tools/prepare-assets.py` 重建动画数据。使用托管版 Pi 可运行 `node test.mjs`；`python3 tests/keyboard.py` 需要本机 Pi 已加载此插件，在 Linux 伪终端中验证键盘流程。
