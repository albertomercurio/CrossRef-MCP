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

// Helper function to generate BibTeX
function generateBibTeX(metadata: any): string {
  const data = metadata.message || metadata;
  
  // Determine entry type
  let entryType = 'article';
  if (data.type === 'book') {
    entryType = 'book';
  } else if (data.type === 'book-chapter') {
    entryType = 'incollection';
  } else if (data.type === 'proceedings-article') {
    entryType = 'inproceedings';
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
  
  // Build BibTeX entry
  let bibtex = `@${entryType}{${citationKey},\n`;
  bibtex += `  title = ${formattedTitle},\n`;
  bibtex += `  author = {${authors}},\n`;
  bibtex += `  year = {${year}},\n`;
  
  // Add journal/publisher info
  if (data['container-title']?.[0]) {
    if (entryType === 'article') {
      bibtex += `  journal = {${data['container-title'][0]}},\n`;
    } else {
      bibtex += `  booktitle = {${data['container-title'][0]}},\n`;
    }
  }
  
  if (data.publisher) {
    bibtex += `  publisher = {${data.publisher}},\n`;
  }
  
  // Add volume, issue, pages
  if (data.volume) {
    bibtex += `  volume = {${data.volume}},\n`;
  }
  if (data.issue) {
    bibtex += `  number = {${data.issue}},\n`;
  }
  if (data.page) {
    bibtex += `  pages = {${data.page}},\n`;
  }
  
  // Add DOI
  if (data.DOI) {
    bibtex += `  doi = {${data.DOI}},\n`;
  }
  
  // Add URL
  if (data.URL) {
    bibtex += `  url = {${data.URL}},\n`;
  }
  
  // Remove trailing comma and close
  bibtex = bibtex.slice(0, -2) + '\n}';
  
  return bibtex;
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
    const doi = args.doi as string;
    
    try {
      // Fetch metadata from CrossRef
      const response = await axios.get(`${CROSSREF_API_URL}/${doi}`, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      
      const data = response.data.message;
      
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
        bibtex: generateBibTeX(data),
        raw_data: data,
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