# Offline Kiwix Wikipedia MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that provides offline access to Wikipedia and other ZIM content through a local [Kiwix](https://kiwix.org/) instance.

## Overview

This MCP server bridges AI language models (like those in LM Studio) with your local Kiwix server, enabling:
- **Offline Wikipedia searches** — No internet required once ZIM files are loaded
- **Multi-ZIM support** — Access Wikipedia, Wiktionary, and other ZIM libraries
- **Token-efficient summaries** — Get just the intro paragraphs to conserve context window
- **Full article retrieval** — Pull complete article text when needed

## Features

| Feature | Description |
|---------|-------------|
| Search | Search within specific ZIM files |
| Full Content | Retrieve complete article text |
| Summaries | Get only introductory paragraphs (token-saving) |
| ZIM Listing | Discover all available ZIM files in your Kiwix instance |

## Prerequisites

- **[Kiwix server](https://wiki.kiwix.org/wiki/Server)** running with ZIM files loaded
- **Node.js 18+** installed
- Local network access to the Kiwix server

## Installation

### 1. Clone and install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example environment file and update it for your setup:

```bash
cp .env.example .env
```

Edit `.env` to point to your Kiwix server:

```env
# Kiwix server address
KIWIX_BASE_URL=http://192.168.1.5:8080

# Default ZIM file (can be overridden per-tool call)
DEFAULT_ZIM=wikipedia_en_all_maxi_2026-02
```

| Variable | Description | Default |
|----------|-------------|---------|
| `KIWIX_BASE_URL` | URL of your Kiwix server | `http://192.168.1.5:8080` |
| `DEFAULT_ZIM` | Default ZIM file name | `wikipedia_en_all_maxi_2026-02` |

## Available Tools

### `search_zim`

Search for entries within a specific ZIM file.

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search query string |
| `zim_file` | No | Target ZIM file (defaults to `DEFAULT_ZIM`) |
| `count` | No | Number of results (default: 3) |

**Example:**
```json
{
  "name": "search_zim",
  "arguments": {
    "query": "quantum physics",
    "zim_file": "wikipedia_en_all_maxi_2026-02",
    "count": 5
  }
}
```

### `get_content`

Retrieve the full text content of an article.

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `title` | Yes | Article title |
| `zim_file` | Yes | Target ZIM file |

**Example:**
```json
{
  "name": "get_content",
  "arguments": {
    "title": "Quantum mechanics",
    "zim_file": "wikipedia_en_all_maxi_2026-02"
  }
}
```

### `get_content_summary`

Get only the introductory summary of an article (token-efficient).

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `title` | Yes | Article title |
| `zim_file` | No | Target ZIM file (defaults to `DEFAULT_ZIM`) |
| `paragraphs` | No | Number of paragraphs to return (default: 2) |

**Example:**
```json
{
  "name": "get_content_summary",
  "arguments": {
    "title": "Quantum mechanics",
    "paragraphs": 3
  }
}
```

### `list_all_zims`

List all ZIM files available in your Kiwix instance.

**Parameters:** None

## Usage in LM Studio

1. Open **LM Studio**
2. Navigate to the **MCP Servers** settings (under the AI Server tab)
3. Click **+ Add MCP Server**
4. Configure:
   - **Name:** `kiwix-wiki`
   - **Type:** `stdio`
   - **Command:** `node server.js`
   - **Working Directory:** Path to this project (e.g., `c:\Users\scott\kiwix-wiki-mcp`)

The server will start automatically and make the tools available to your AI model.

## Usage in Other MCP Clients

This server uses the stdio transport protocol, which is supported by most MCP clients. Configure it with:

- **Transport:** `stdio`
- **Command:** `node server.js`
- **Working Directory:** Project root

## Running Manually

For development or testing:

```bash
npm start
```

The server runs in stdio mode — it reads from stdin and writes to stdout. To test interactively, you can use an MCP client SDK or the [@modelcontextprotocol/cli](https://www.npmjs.com/package/@modelcontextprotocol/cli):

```bash
npx @modelcontextprotocol/cli install
npx @modelcontextprotocol/cli list-tools
```

## Project Structure

```
kiwix-wiki-mcp/
├── .env.example      # Environment template
├── .env              # Your configuration (gitignored)
├── .gitignore        # Git ignore rules
├── server.js         # MCP server implementation
├── package.json      # Dependencies and scripts
└── README.md         # This file
```

## License

MIT License. See [LICENSE](LICENSE) file for details.