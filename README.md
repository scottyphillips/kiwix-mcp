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
| Search with Snippets | Search and get short content previews (~200 chars) for relevance evaluation (token-saving) |
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

### `search_with_snippets`

Search for articles and return short content snippets (~200 chars) from each result. Use this to evaluate relevance before fetching full content with `get_content`. This is the most token-efficient way to explore multiple articles at once.

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search query string |
| `zim_file` | No | Target ZIM file (defaults to `DEFAULT_ZIM`) |
| `count` | No | Number of results (default: 3). Each result includes a ~200 character content snippet. |

**Example:**
```json
{
  "name": "search_with_snippets",
  "arguments": {
    "query": "quantum physics",
    "zim_file": "wikipedia_en_all_maxi_2026-02",
    "count": 3
  }
}
```

**Response format (JSON array):**
```json
[
  {
    "title": "Quantum mechanics",
    "snippet": "Quantum mechanics is a fundamental theory in physics that describes the physical properties of nature at the scale of atoms and subatomic particles. It provides a mathematical framework for understanding phenomena...",
    "url": "/wikipedia_en_all_maxi_2026-02/Quantum_mechanics"
  },
  {
    "title": "Quantum field theory",
    "snippet": "Quantum field theory (QFT) is the theoretical framework describing the physics of quantum fields. QFT is used in particle physics and condensed matter physics to construct physical models...",
    "url": "/wikipedia_en_all_maxi_2026-02/Quantum_field_theory"
  }
]
```

**Token-efficient workflow:**
1. Use `search_with_snippets` to get previews of multiple articles
2. Evaluate relevance from the snippets (~200 chars each)
3. Only call `get_content` or `get_content_summary` for the most relevant article(s)

### `get_content`

Retrieve the full text content of an article. Tables (infoboxes, comparison tables), navigation elements, images, and reference footers are automatically stripped to minimize token usage while preserving article body text.

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

## Testing

A comprehensive test harness is included to verify your Kiwix instance is working correctly.

### Run All Tests

```bash
npm test
```

This runs **17 tests** covering:

| Category | Tests |
|----------|-------|
| **Connectivity** | Server reachability, home page content |
| **ZIM Files** | List all available ZIM files (XML/JSON parsing) |
| **Search** | Basic search, no results, count parameter, special characters, multi-ZIM |
| **Content** | Article retrieval, invalid ZIM handling |
| **Performance** | Search response time, content response time |
| **Search with Snippets** | Basic functionality, count parameter, empty results, content quality |

### Test Output

Results are printed to the console and saved to `test-results.json`:

```json
{
  "timestamp": "2026-06-13T07:42:24.152Z",
  "target": "http://192.168.1.5:8080",
  "defaultZim": "wikipedia_en_all_maxi_2026-02",
  "totalTests": 17,
  "passedTests": 17,
  "failedTests": 0,
  "successRate": "100.0%",
  "results": [...]
}
```

### Custom Configuration

Override defaults via environment variables:

```bash
KIWIX_BASE_URL=http://192.168.1.100:8080 DEFAULT_ZIM=my_custom_zim npm test
```

### Running Manually

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
├── test-harness.js   # Test harness for Kiwix connectivity testing
├── test-results.json # Generated test results (JSON format)
├── package.json      # Dependencies and scripts
└── README.md         # This file
```

## Token Optimization Tips

### Automatic Optimizations

| Feature | Description | Savings |
|---------|-------------|---------|
| Table stripping | Infoboxes, comparison tables, and reference footers are excluded from `get_content`, `get_content_summary`, and `search_with_snippets` output | 10-30% per article |
| Navigation stripping | Sidebars, category links, and navigation elements are removed | ~5-10% per article |
| Citation removal | Numeric citation brackets like `[1]`, `[2][3]` are stripped from all content tools | ~200-800 tokens per article |
| [edit] marker removal | Section heading markers like `"Quantum mechanics[edit]"` are cleaned | ~50-200 tokens per article |
| Low-value section removal | "See also", "Further reading", "External links", and "References" sections are stripped from `get_content` output | ~1,000-4,000 tokens per full article |

### Recommended Workflow

For the most token-efficient RAG workflow, follow this pattern:

```
1. search_with_snippets → Get ~200 char previews of N articles (~500-800 tokens total)
2. Evaluate relevance from snippets (no additional tokens consumed)
3. get_content_summary → Fetch only the most relevant article's intro (~200-400 tokens)
4. get_content → Only if full details are needed (~5,000-20,000+ tokens)
```

### Best Practices

| Practice | Benefit |
|----------|---------|
| Always start with `search_with_snippets` | Avoid fetching content for irrelevant articles |
| Use `count: 1-3` in search | Limit results to the most relevant articles |
| Prefer `get_content_summary` over `get_content` | Get intro paragraphs at ~5% of the token cost |
| Specify `zim_file` explicitly | Avoid searching wrong ZIM files and wasting queries |
| Use descriptive search queries | More specific queries return more relevant results |

## License

MIT License. See [LICENSE](LICENSE) file for details.
