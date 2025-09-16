#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';

// CrossRef API configuration
const CROSSREF_API_URL = 'https://api.crossref.org/works';
const USER_AGENT = process.env.USER_AGENT || 'CrossRefMCP/1.0';

// Helper function to format author names
function formatAuthor(author: any): string {
  // Try to get the fullest possible name representation
  if (author.given && author.family) {
    return `${author.given} ${author.family}`;
  } else if (author.family) {
    return author.family;
  } else if (author.name) {
    // Some entries may have a single 'name' field with full name
    return author.name;
  }
  return 'Unknown Author';
}

// Helper function to fetch full name from ORCID (when available)
async function fetchORCIDName(orcid: string): Promise<string | null> {
  try {
    // Clean ORCID - remove URL prefix if present
    const cleanORCID = orcid.replace('https://orcid.org/', '').replace('http://orcid.org/', '');
    
    const response = await axios.get(`https://pub.orcid.org/v3.0/${cleanORCID}/person`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    
    const person = response.data;
    const name = person.name;
    
    if (name && name['given-names'] && name['family-name']) {
      const givenNames = name['given-names'].value;
      const familyName = name['family-name'].value;
      return `${givenNames} ${familyName}`;
    }
    
    return null;
  } catch (error) {
    // If ORCID lookup fails, return null to use fallback
    return null;
  }
}

// Enhanced helper function to format author names with ORCID lookup
async function formatAuthorEnhanced(author: any): Promise<{
  given: string;
  family: string;
  full_name: string;
  orcid: string | null;
  name_source: 'crossref' | 'orcid' | 'fallback';
}> {
  const given = author.given || '';
  const family = author.family || '';
  let fullName = formatAuthor(author);
  let nameSource: 'crossref' | 'orcid' | 'fallback' = 'crossref';
  const orcid = author.ORCID || null;
  
  // If we have an ORCID and the given name appears abbreviated (1-2 chars + period), try ORCID lookup
  if (orcid && given && given.length <= 3 && given.includes('.')) {
    try {
      const orcidName = await fetchORCIDName(orcid);
      if (orcidName) {
        fullName = orcidName;
        nameSource = 'orcid';
        
        // Try to extract given name from ORCID for consistency
        const nameParts = orcidName.split(' ');
        if (nameParts.length >= 2) {
          const orcidGiven = nameParts.slice(0, -1).join(' ');
          const orcidFamily = nameParts[nameParts.length - 1];
          
          return {
            given: orcidGiven,
            family: orcidFamily,
            full_name: fullName,
            orcid,
            name_source: nameSource
          };
        }
      }
    } catch (error) {
      // Continue with CrossRef data if ORCID lookup fails
    }
  }
  
  if (fullName === 'Unknown Author') {
    nameSource = 'fallback';
  }
  
  return {
    given,
    family,
    full_name: fullName,
    orcid,
    name_source: nameSource
  };
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

// Helper function to generate BibTeX from metadata (fallback) with enhanced authors
async function generateBibTeXFromMetadataEnhanced(data: any): Promise<string> {
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
  
  // Format authors with enhanced processing
  let authors = 'Unknown';
  if (data.author && data.author.length > 0) {
    const enhancedAuthors = await Promise.all(
      data.author.map((a: any) => formatAuthorEnhanced(a))
    );
    authors = enhancedAuthors.map(a => a.full_name).join(' and ');
  }
  
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

// Handle initialization
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  return {
    protocolVersion: "2025-06-18",
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "crossref-mcp-server",
      version: "1.0.0",
    },
  };
});

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
        // Fallback to generating from metadata with enhanced authors
        bibtex = await generateBibTeXFromMetadataEnhanced(data);
      }
      
      // Extract and format metadata with enhanced author processing
      const authorsPromises = data.author?.map((author: any) => formatAuthorEnhanced(author)) || [];
      const authors = await Promise.all(authorsPromises);
      
      const metadata = {
        doi: data.DOI,
        title: data.title?.[0] || 'Untitled',
        authors: authors,
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