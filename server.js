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

// Snippet length in characters for search_with_snippets tool
const SNIPPET_LENGTH = 200;

/**
 * Clean Wikipedia/article text by removing markers, citations, and low-value sections.
 * Removes: [edit] markers, citation numbers, See also/Further reading/External links/References sections.
 */
function cleanArticleText(text) {
  // Remove [edit] markers from headings
  let cleaned = text.replace(/\[edit\]/gi, '');

  // Remove numeric citation brackets at end of lines: "text[1]", "text[2][3]", or "[1]" alone
  // Preserves: IPA notation mid-word (e.g., "[i]" in middle of sentence), chemical formulas, wikilinks {{...}}
  cleaned = cleaned.replace(/(?:\b|\])(\[\d+\])+\s*$/gm, '');

  // Remove "See also", "Further reading", "External links", "References" sections (to end of text)
  const lowValueSections = [
    'see also',
    'further reading',
    'external links',
    'references'
  ];
  for (const section of lowValueSections) {
    // Match == Section == or ==Section== through end of content
    const regex = new RegExp(`\\n{0,2}={1,3}\\s*${section}\\s*={1,3}[\\s\\S]*$`, 'i');
    cleaned = cleaned.replace(regex, '');
    
    // Also match at top level without == markers (plain text headings)
    const lineRegex = new RegExp(`\\n{0,2}(?<!\\w)${section}\\b[\\s\\S]*?(?=\\n{2,}|$)`, 'i');
    cleaned = cleaned.replace(lineRegex, '');
  }

  // Remove standalone Notes section
  cleaned = cleaned.replace(/={1,3}\s*notes\s*={1,3}[\s\S]*$/i, '');

  return cleaned.trim();
}

/**
 * Parse Kiwix search results into array of {title, url} objects.
 * Handles JSON, XML Atom OPDS feed, and HTML search result pages.
 */
function parseSearchResults(searchData) {
  // Try JSON parsing first (Kiwix returns JSON when Accept: application/json)
  try {
    const data = JSON.parse(searchData);
    if (data.results && Array.isArray(data.results)) {
      return data.results.map(r => ({ 
        title: r.title || r.canonical_title || 'Unknown', 
        url: r.url || r.path || '' 
      }));
    }
  } catch {}

  // Try XML Atom OPDS feed parsing (Kiwix returns XML for OPDS-compatible clients)
  const xmlEntries = searchData.match(/<entry[^>]*>([\s\S]*?)<\/entry>/g) || [];
  if (xmlEntries.length > 0) {
    return xmlEntries.map(entry => {
      const titleMatch = entry.match(/<title>(.*?)<\/title>/);
      const hrefMatch = entry.match(/href=["']([^"']+)["']/);
      return {
        title: titleMatch?.[1]?.trim() || 'Unknown',
        url: hrefMatch?.[1] || ''
      };
    });
  }

  // Try HTML search results parsing (Kiwix returns HTML for browser requests)
  const htmlResults = searchData.match(/<li[^>]*>\s*<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g) || [];
  if (htmlResults.length > 0) {
    return htmlResults.map(result => {
      const hrefMatch = result.match(/href="([^"]*)"/);
      // Extract title, stripping HTML tags and <b> highlight markers
      let title = result.replace(/<a[^>]*>/i, '').replace(/<\/a>/i, '');
      title = title.replace(/<[^>]+>/g, '').trim();
      return {
        title: title || 'Unknown',
        url: hrefMatch?.[1] || ''
      };
    });
  }

  // Fallback: treat each line as a result (plain text format)
  const lines = searchData.split('\n').filter(l => l.trim());
  return lines.map(line => ({
    title: line.trim(),
    url: line.trim()
  }));
}

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
        name: "search_with_snippets",
        description: "Search for articles and return short content snippets (~200 chars) from each result. Use this to evaluate relevance before fetching full content with 'get_content'. Returns JSON array with title, snippet, and URL for each result. This is the most token-efficient way to explore multiple articles at once.",
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
              description: "Maximum number of results to return (default: 3). Each result includes a ~200 character content snippet for relevance evaluation." 
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

      case "search_with_snippets": {
        // Default to a small number if not specified
        const resultCount = args?.count || 3;
        
        // Step 1: Perform the search
        const searchUrl = `/search?pattern=${encodeURIComponent(args.query)}&books.name=${targetZim}&count=${resultCount}`;
        const searchData = await fetchKiwix(searchUrl);
        const results = parseSearchResults(searchData);
        
        if (results.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify([], null, 2) }]
          };
        }
        
        // Step 2: Fetch a short snippet from each result
        const snippets = [];
        for (const entry of results) {
          try {
            let sanitizedTitle = entry.title.replace(/ /g, "_");
            const pageUrl = `/content/${targetZim}/${sanitizedTitle}`;
            const rawHtml = await fetchKiwix(pageUrl);
            
            // Convert HTML to clean text with table/citation/section removal
            const rawCleanText = convert(rawHtml, {
              wordwrap: false,
              selectors: [
                { selector: 'img', format: 'skip' },
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'nav', format: 'skip' },
                { selector: 'table', format: 'skip' },
                { selector: 'footer', format: 'skip' }
              ]
            });
            
            // Remove [edit] markers, citation numbers, and low-value sections (first 500 chars only)
            const cleanText = cleanArticleText(rawCleanText);
            
            // Truncate to SNIPPET_LENGTH characters with ellipsis
            const snippet = cleanText.substring(0, SNIPPET_LENGTH).trim();
            const truncated = cleanText.length > SNIPPET_LENGTH;
            
            snippets.push({
              title: entry.title,
              snippet: truncated ? snippet + '...' : snippet,
              url: entry.url || `/${targetZim}/${sanitizedTitle}`
            });
          } catch (err) {
            // If content fetch fails for a specific entry, include placeholder
            snippets.push({
              title: entry.title,
              snippet: '(Could not fetch content snippet)',
              url: entry.url || ''
            });
          }
        }
        
        return {
          content: [{ type: "text", text: JSON.stringify(snippets, null, 2) }]
        };
      }

      case "get_content": {
              let sanitizedTitle = args.title.replace(/ /g, "_");
              const pageUrl = `/content/${targetZim}/${sanitizedTitle}`;
              const rawHtml = await fetchKiwix(pageUrl);
              
              // Use html-to-text for clean output with table/infobox stripping
              const rawCleanText = convert(rawHtml, {
                wordwrap: false,
                selectors: [
                  { selector: 'img', format: 'skip' },
                  { selector: 'a', options: { ignoreHref: true } },
                  { selector: 'table', format: 'skip' },      // Skip infoboxes, comparison tables
                  { selector: 'nav', format: 'skip' },         // Skip navigation elements
                  { selector: 'footer', format: 'skip' }       // Skip reference footers
                ]
              });
              
              // Remove [edit] markers, citation numbers, and low-value sections
              const cleanText = cleanArticleText(rawCleanText);

              return {
                content: [{ type: "text", text: cleanText }]
              };
            }

      case "get_content_summary": {
              let sanitizedTitle = args.title.replace(/ /g, "_");
              const pageUrl = `/content/${targetZim}/${sanitizedTitle}`;
              
              // Fetch the raw HTML
              const rawHtml = await fetchKiwix(pageUrl);
              
              // Strip the HTML with table/navigation/infobox removal
              const rawCleanText = convert(rawHtml, {
                wordwrap: false,
                selectors: [
                  { selector: 'img', format: 'skip' },
                  { selector: 'a', options: { ignoreHref: true } },
                  { selector: 'nav', format: 'skip' },
                  { selector: 'table', format: 'skip' }, // Skip infoboxes for a cleaner text summary
                  { selector: 'footer', format: 'skip' }
                ]
              });

              // Remove [edit] markers, citation numbers, and low-value sections
              const cleanText = cleanArticleText(rawCleanText);

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
