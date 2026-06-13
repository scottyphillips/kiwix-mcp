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
        description: "Search for entries within a specific ZIM file (e.g., Wikipedia or Wiktionary)",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            zim_file: { 
              type: "string", 
              description: "The specific ZIM file to search. If omitted, defaults to Wikipedia." 
            },
            count: { 
              type: "number", 
              description: "Maximum number of search results to return. Use a low number (e.g., 3-5) to save tokens." 
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_content",
        description: "Get the full text content of an entry from a specific ZIM file",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The article or word title" },
            zim_file: { 
              type: "string", 
              description: "The specific ZIM file to use." 
            }
          },
          required: ["title", "zim_file"]
        }
      },
      {
        name: "get_content_summary",
        description: "Fetch only the introductory summary of a specific page to save tokens.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Exact title of the page" },
            zim_file: { 
              type: "string", 
              description: "The specific ZIM file. Defaults to Wikipedia." 
            },
            paragraphs: { 
              type: "number", 
              description: "Number of paragraphs to return. Defaults to 2." 
            }
          },
          required: ["title"]
        }
      },
      {
        name: "list_all_zims",
        description: "List all available ZIM files currently loaded in your Kiwix instance",
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
