#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';

// CrossRef API configuration
const CROSSREF_API_URL = 'https://api.crossref.org/works';
const USER_AGENT = process.env.USER_AGENT || 'CrossRefMCP/1.0';

// Helper function to format author names
function formatAuthor(author: any): string {
  if (author.given && author.family) {
    return `${author.given} ${author.family}`;
  } else if (author.family) {
    return author.family;
  } else if (author.name) {
    return author.name;
  }
  return 'Unknown Author';
}

// Helper function to fetch and format BibTeX
async function fetchBibTeX(doi: string): Promise<string | null> {
  try {
    // Try to get BibTeX directly from CrossRef
    const response = await axios.get(`${CROSSREF_API_URL}/${doi}/transform/application/x-bibtex`, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    });
    
    let bibtex = response.data;
    
    // Remove abstract field if present
    bibtex = bibtex.replace(/^\s*abstract\s*=\s*{[^}]*},?\s*$/gm, '');
    
    // Wrap title in double curly brackets if not already
    bibtex = bibtex.replace(/title\s*=\s*{([^}]*)}/g, (match: string, title: string) => {
      // Check if already has double brackets
      if (title.startsWith('{') && title.endsWith('}')) {
        return match;
      }
      return `title = {{${title}}}`;
    });
    
    return bibtex;
  } catch (error) {
    // If direct BibTeX fetch fails, return null to use fallback
    return null;
  }
}

// Helper function to generate BibTeX from metadata (fallback)
function generateBibTeXFromMetadata(data: any): string {
  // Determine entry type
  let entryType = 'article';
  if (data.type === 'book') {
    entryType = 'book';
  } else if (data.type === 'book-chapter') {
    entryType = 'incollection';
  } else if (data.type === 'proceedings-article') {
    entryType = 'inproceedings';
  } else if (data.type === 'report') {
    entryType = 'techreport';
  } else if (data.type === 'thesis' || data.type === 'dissertation') {
    entryType = 'phdthesis';
  }
  
  // Generate citation key
  const firstAuthor = data.author?.[0];
  const authorName = firstAuthor?.family || 'Unknown';
  const year = data['published-print']?.['date-parts']?.[0]?.[0] || 
                data['published-online']?.['date-parts']?.[0]?.[0] || 
                new Date().getFullYear();
  const citationKey = `${authorName}${year}`.replace(/[^a-zA-Z0-9]/g, '');
  
  // Format title with double curly brackets
  const title = data.title?.[0] || 'Untitled';
  const formattedTitle = `{{${title}}}`;
  
  // Format authors
  const authors = data.author?.map((a: any) => formatAuthor(a)).join(' and ') || 'Unknown';
  
  // Build BibTeX entry with proper formatting
  const fields = [];
  fields.push(`  title = ${formattedTitle}`);
  fields.push(`  author = {${authors}}`);
  fields.push(`  year = {${year}}`);
  
  // Add journal/publisher info
  if (data['container-title']?.[0]) {
    if (entryType === 'article') {
      fields.push(`  journal = {${data['container-title'][0]}}`);
    } else if (entryType === 'incollection' || entryType === 'inproceedings') {
      fields.push(`  booktitle = {${data['container-title'][0]}}`);
    }
  }
  
  if (data.publisher) {
    fields.push(`  publisher = {${data.publisher}}`);
  }
  
  // Add volume, issue, pages
  if (data.volume) {
    fields.push(`  volume = {${data.volume}}`);
  }
  if (data.issue) {
    fields.push(`  number = {${data.issue}}`);
  }
  if (data.page) {
    fields.push(`  pages = {${data.page}}`);
  }
  
  // Add DOI
  if (data.DOI) {
    fields.push(`  doi = {${data.DOI}}`);
  }
  
  // Add URL
  if (data.URL) {
    fields.push(`  url = {${data.URL}}`);
  }
  
  // Construct final BibTeX
  return `@${entryType}{${citationKey},\n${fields.join(',\n')}\n}`;
}

// Main server setup
const server = new Server(
  {
    name: "crossref-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "fetch_doi_metadata",
        description: "Fetch metadata for a DOI from CrossRef API",
        inputSchema: {
          type: "object",
          properties: {
            doi: {
              type: "string",
              description: "The DOI to fetch metadata for (e.g., '10.1038/nature12373')",
            },
          },
          required: ["doi"],
        },
      },
      {
        name: "fetch_references",
        description: "Fetch references cited by a paper (if available)",
        inputSchema: {
          type: "object",
          properties: {
            doi: {
              type: "string",
              description: "The DOI to fetch references for",
            },
          },
          required: ["doi"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === "fetch_doi_metadata") {
    if (!args || !args.doi) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Missing required parameter: doi"
      );
    }
    const doi = args.doi as string;
    
    try {
      // Fetch metadata from CrossRef
      const response = await axios.get(`${CROSSREF_API_URL}/${doi}`, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      
      const data = response.data.message;
      
      // Try to get proper BibTeX
      let bibtex = await fetchBibTeX(doi);
      if (!bibtex) {
        // Fallback to generating from metadata
        bibtex = generateBibTeXFromMetadata(data);
      }
      
      // Extract and format metadata
      const metadata = {
        doi: data.DOI,
        title: data.title?.[0] || 'Untitled',
        authors: data.author?.map((author: any) => ({
          given: author.given || '',
          family: author.family || '',
          full_name: formatAuthor(author),
          orcid: author.ORCID || null,
        })) || [],
        journal: {
          full_name: data['container-title']?.[0] || '',
          abbreviated: data['short-container-title']?.[0] || data['container-title']?.[0] || '',
          issn: data.ISSN || [],
        },
        year: data['published-print']?.['date-parts']?.[0]?.[0] || 
              data['published-online']?.['date-parts']?.[0]?.[0] || null,
        volume: data.volume || null,
        issue: data.issue || null,
        pages: data.page || null,
        publisher: data.publisher || null,
        abstract: data.abstract || null,
        url: data.URL || null,
        type: data.type || 'article',
        published_date: data['published-print'] || data['published-online'] || null,
        references_count: data['references-count'] || 0,
        is_referenced_by_count: data['is-referenced-by-count'] || 0,
        bibtex: bibtex,
      };
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(metadata, null, 2),
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch metadata for DOI ${doi}: ${error.message}`
      );
    }
  }
  
  if (name === "fetch_references") {
    if (!args || !args.doi) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Missing required parameter: doi"
      );
    }
    const doi = args.doi as string;
    
    try {
      // Note: CrossRef doesn't always provide references via the public API
      // This is a simplified implementation
      const response = await axios.get(`${CROSSREF_API_URL}/${doi}`, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      
      const data = response.data.message;
      
      if (data.reference) {
        const references = data.reference.map((ref: any) => ({
          key: ref.key || null,
          doi: ref.DOI || null,
          title: ref['article-title'] || ref['volume-title'] || null,
          author: ref.author || null,
          year: ref.year || null,
          journal: ref['journal-title'] || null,
          volume: ref.volume || null,
          issue: ref.issue || null,
          pages: ref['first-page'] || null,
          raw: ref,
        }));
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                doi: doi,
                references_count: references.length,
                references: references,
              }, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                doi: doi,
                references_count: 0,
                references: [],
                message: "No references available for this DOI",
              }, null, 2),
            },
          ],
        };
      }
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch references for DOI ${doi}: ${error.message}`
      );
    }
  }
  
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CrossRef MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});