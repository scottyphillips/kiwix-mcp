import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { convert } from "html-to-text"; // Add this import

// The base IP of your Kiwix server (override via KIWIX_BASE_URL env var)
const KIWIX_BASE = process.env.KIWIX_BASE_URL || "http://192.168.1.5:8080";

// Default ZIM file to use if none is specified (Wikipedia) (override via DEFAULT_ZIM env var)
const DEFAULT_ZIM = process.env.DEFAULT_ZIM || "wikipedia_en_all_maxi_2026-02";

const server = new Server(
  {
    name: "kiwix-multi-tool-mcp",
    version: "1.1.2",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

async function fetchKiwix(url) {
  try {
    const response = await fetch(KIWIX_BASE + url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error("Fetch error:", error.message);
    throw error;
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_zim",
        description: "Search for entries within a specific ZIM file. Returns results in JSON format with entry titles and URLs. Use keyword search terms to find relevant articles.",
        inputSchema: {
          type: "object",
          properties: {
            query: { 
              type: "string", 
              description: "Search terms or keywords to find in the ZIM file content" 
            },
            zim_file: { 
              type: "string", 
              description: "The specific ZIM file to search. If omitted, defaults to your default ZIM file." 
            },
            count: { 
              type: "number", 
              description: "Maximum number of results to return (default: 3). Use lower values (1-3) to save tokens." 
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_content",
        description: "Retrieve the complete text content of an article from a ZIM file. Returns all sections as plain text (no HTML). Use this when you need full article details; for quick overviews, use 'get_content_summary' instead. WARNING: Full articles can be very long and token-intensive.",
        inputSchema: {
          type: "object",
          properties: {
            title: { 
              type: "string", 
              description: "Article or entry title (spaces are automatically converted)" 
            },
            zim_file: { 
              type: "string", 
              description: "Name of the ZIM file (required). Example: 'wikipedia_en_all_maxi_2026-02'" 
            }
          },
          required: ["title", "zim_file"]
        }
      },
      {
        name: "get_content_summary",
        description: "Get the first few paragraphs of an article's introduction section. Returns plain text (no HTML) containing only the opening section of the page. Use this for quick topic overviews instead of 'get_content' which returns the full article.",
        inputSchema: {
          type: "object",
          properties: {
            title: { 
              type: "string", 
              description: "Article title (spaces are automatically converted to underscores)" 
            },
            zim_file: { 
              type: "string", 
              description: "ZIM file name. Only specify if different from your default ZIM file. Example: 'wikipedia_en_all_maxi_2026-02'" 
            },
            paragraphs: { 
              type: "number", 
              description: "Number of opening paragraphs to return (default: 2). Use 1-2 for brief overview, 3-5 for detailed summary." 
            }
          },
          required: ["title"]
        }
      },
      {
        name: "list_all_zims",
        description: "List all available ZIM files currently loaded in your Kiwix instance. Returns JSON with file details including names, titles, and descriptions.",
        inputSchema: {
          type: "object",
          properties: {} // This was missing, causing the error
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  // Determine which ZIM to use: arg provided > DEFAULT_ZIM
  const targetZim = args?.zim_file || DEFAULT_ZIM;

  try {
    switch (name) {
      case "search_zim": {
              
              // Default to a small number (e.g., 3) if the LLM doesn't specify one
              const resultCount = args?.count || 3; 
              
              // Append &count to the URL
              const searchUrl = `/search?pattern=${encodeURIComponent(args.query)}&books.name=${targetZim}&count=${resultCount}`;

              const content = await fetchKiwix(searchUrl);
              return {
                content: [{ type: "text", text: content }]
              };
            }

      case "get_content": {
              let sanitizedTitle = args.title.replace(/ /g, "_");
              const pageUrl = `/content/${targetZim}/${sanitizedTitle}`;
              const rawHtml = await fetchKiwix(pageUrl);
              
              // Brute-force strip tags and collapse excess whitespace
              const cleanText = rawHtml
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Attempt to kill CSS
                  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Attempt to kill JS
                  .replace(/<[^>]+>/g, ' ') // Replace all other tags with a space
                  .replace(/\s+/g, ' ') // Collapse multiple spaces into one
                  .trim();

              return {
                content: [{ type: "text", text: cleanText }]
              };
            }

      case "get_content_summary": {
              let sanitizedTitle = args.title.replace(/ /g, "_");
              const pageUrl = `/content/${targetZim}/${sanitizedTitle}`;
              
              // Fetch the raw HTML
              const rawHtml = await fetchKiwix(pageUrl);
              
              // Strip the HTML
              const cleanText = convert(rawHtml, {
                wordwrap: false,
                selectors: [
                  { selector: 'img', format: 'skip' },
                  { selector: 'a', options: { ignoreHref: true } },
                  { selector: 'nav', format: 'skip' },
                  { selector: 'table', format: 'skip' }, // Skip infoboxes for a cleaner text summary
                  { selector: 'footer', format: 'skip' }
                ]
              });

              // Determine how many paragraphs to keep (default: 2)
              const paraCount = args?.paragraphs || 2;

              // Split by double newlines, filter out empty strings, and grab the first N paragraphs
              const summaryText = cleanText
                .split('\n\n')
                .map(p => p.trim())
                .filter(p => p.length > 0) // Remove blank lines
                .slice(0, paraCount)
                .join('\n\n');

              return {
                content: [{ 
                  type: "text", 
                  text: summaryText || "No summary available for this page." 
                }]
              };
            }

      case "list_all_zims": {
        const catalogUrl = "/catalog/v2/entries";
        const content = await fetchKiwix(catalogUrl);
        return {
          content: [{ type: "text", text: content }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error accessing Kiwix (${targetZim}): ${error.message}` }],
      isError: true
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Multi-ZIM MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
