<h1 align="center">MultiModel for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="Install from VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/Vizards/deepseek-v4-for-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="Install from Open VSX"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/Vizards/deepseek-v4-for-copilot?style=for-the-badge&label=Version" alt="Version" />
  <img src="https://vsmarketplacebadges.dev/installs-short/Vizards.deepseek-v4-for-copilot.svg?style=for-the-badge" alt="Installs" />
</p>

<p align="center">
  English |
  <a href="https://github.com/Vizards/deepseek-v4-for-copilot/blob/main/README.zh-cn.md">简体中文</a>
</p>

**Pick DeepSeek V4, MiniMax, and more from the Copilot Chat model picker — and keep everything else Copilot already gives you.**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="DeepSeek V4 Pro and Flash in the Copilot Chat model picker, with the per-model Thinking Effort dropdown (None / High / Max)" width="800">
</p>

Love DeepSeek's price-performance but don't want to give up GitHub Copilot's agent mode, tool calling, and polished UI? This extension drops **DeepSeek V4, MiniMax, and more** straight into the Copilot Chat model selector — with **vision**, **thinking mode**, and your own API key.

## Why this extension?

- **Don't replace Copilot — power it up.** No new sidebar, no new chat UI to learn. Just new models in the picker you already use.
- **Agent mode, tool calling, instructions, MCP, skills — all of it still works.** Copilot's entire stack, now running on your model of choice.
- **Vision on text-only models.** Some models can't see images. This extension proxies any image you drop into chat through another Copilot model you already have, then feeds the description — transparently.
- **BYOK, pay providers directly.** Your API key, your bill, your rate limits. Stored in the OS keychain, never on disk.

## Features

### DeepSeek V4, MiniMax & more in the model picker
Models show up alongside GPT-4o, Claude, and friends in Copilot Chat's model selector. Up to 1M token context. Switch models mid-chat without losing history.

### Transparent Vision Proxy
Some models are text-only. Drop a screenshot into chat and this extension automatically hands the image to another installed Copilot model (Claude, GPT-4o, whatever you've got), gets a description, and feeds that back. **Zero config** — just pick your preferred vision model once.

<p align="center">
  <img src="resources/screenshots/03-vision.png" alt="Dropping an image into Copilot Chat and a model responding to it via the vision proxy" width="800">
</p>

### Thinking Mode with Reasoning Effort Control
Full support for models' reasoning capabilities. Use Copilot Chat's native model picker menu to choose `none` (off), `high` (balanced, default), or `max` (deep reasoning for hard agent tasks).

### Inherits Every Copilot Capability
Because this plugs into Copilot's native provider API, you get the full stack for free:
- **Agent mode** — autonomous multi-step tasks
- **Tool calling** — file edits, terminal, workspace search, Git, tests
- **Instructions & skills** — all your `.instructions.md`, `AGENTS.md`, and skills just work
- **Cache statistics** — prompt cache hit rate logged in the output channel so you can see the savings

<p align="center">
  <img src="resources/screenshots/04-agent.png" alt="DeepSeek V4 Pro running Copilot's agent mode with tool calls" width="800">
</p>

### Secure by Default
API key lives in VS Code's `SecretStorage` (OS keychain on macOS / Windows / Linux). Never in `settings.json`, never in your Git history.

### Zero Runtime Dependencies
Pure VS Code API + Node.js built-ins. No Python, no Docker, no local proxy server to babysit.

## Getting Started

### Prerequisites

- VS Code 1.116 or later. This extension relies on non-public Copilot Chat APIs that may break on newer VS Code versions — [report an issue](https://github.com/Vizards/deepseek-v4-for-copilot/issues) if you hit one.
- GitHub Copilot subscription (Free / Pro / Enterprise — the free tier works)
- DeepSeek API key from [platform.deepseek.com](https://platform.deepseek.com), or a compatible provider token when using a custom `deepseek-copilot.baseUrl`

### Installation

Install from the registry used by your editor:

1. **Microsoft VS Code** — install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot).
2. **Editors that use Open VSX** — install from [Open VSX](https://open-vsx.org/extension/Vizards/deepseek-v4-for-copilot).

### Usage

1. Run **MultiModel: Set API Key** from the Command Palette (`Cmd+Shift+P`)
2. Paste your key or compatible provider token (official DeepSeek keys usually start with `sk-`)
3. Open Copilot Chat, click the model picker, and choose the model you want
4. That's it — chat away

## Models

| Model | Best For |
|---|---|
| **DeepSeek V4 Flash** | Fast everyday coding, quick edits, cheap iteration |
| **DeepSeek V4 Pro** | Complex refactors, agent tasks, deep reasoning |
| **MiniMax-M3** | Frontier coding & agentic tasks, 1M context, multimodal |
| **MiniMax-M2.7** | Balanced reasoning and speed |
| **MiniMax-M2.7 High-Speed** | Faster responses, same quality as M2.7 |
| **MiMo V2.5 / V2.5 Pro** | Multimodal reasoning (Xiaomi) |
| **OpenCode Go models** | DeepSeek, MiMo, GLM, Kimi, MiniMax, Qwen via Go proxy |

All models support optional thinking mode and tool calling where applicable.

## Settings

| Setting | Default | Description |
|---|---|---|
| `deepseek-copilot.baseUrl` | `https://api.deepseek.com` | API endpoint — change for self-hosted / proxied deployments |
| `deepseek-copilot.maxTokens` | `0` | Max output tokens (`0` = no limit). Useful for cost control |
| `deepseek-copilot.modelIdOverrides` | prefilled official ID map | API model IDs to send for each model. Change only for compatible third-party APIs with different model names |
| `deepseek-copilot.debugMode` | `minimal` | Diagnostic mode: `minimal` for token usage only, `metadata` for privacy-preserving logs, or `verbose` for full request dumps and pipeline snapshots under extension global storage. Full dumps may include sensitive prompt text, tool schemas, file snippets, and image descriptions. Use `MultiModel: Open Request Dumps Folder` to open the dump location |
| `deepseek-copilot.visionModel` | *(auto)* | Which Copilot model to proxy images through |
| `deepseek-copilot.visionPrompt` | *(built-in)* | Prompt used to describe image attachments |
| `deepseek-copilot.experimental.stabilizeToolList` | `false` | Experimental. Tries to pre-activate VS Code/Copilot virtual tools so the provider `tools` parameter is more complete and stable across turns. May improve context-cache hit rate when enabled tools change between turns. Can increase input tokens because more function definitions may be included; cache-hit input tokens are cheaper but still count toward usage. Usually leave it off with 64 or fewer enabled tools unless the tool list still changes across turns; do not enable it with more than 128 enabled tools |

Thinking Effort is configured from Copilot Chat's model picker for each supported model.

Example `settings.json` override for compatible API proxies:

```json
{
  "deepseek-copilot.modelIdOverrides": {
    "deepseek-v4-flash": "your-flash-model-id",
    "deepseek-v4-pro": "your-pro-model-id"
  }
}
```

## Compared to alternatives

| | This extension | Local proxy (e.g. LiteLLM) | Standalone DeepSeek extensions |
|---|---|---|---|
| Works inside Copilot Chat | ✅ | ✅ | ❌ separate UI |
| Agent mode, tools, skills | ✅ | ✅ | ⚠️ reimplemented |
| Vision support | ✅ proxied | ❌ | ❌ |
| No extra process to run | ✅ | ❌ | ✅ |
| One-click install | ✅ | ❌ | ✅ |
| API key in OS keychain | ✅ | ❌ | ⚠️ varies |

## License

[MIT](LICENSE)
