# CrossRef MCP Server

A Model Context Protocol (MCP) server for fetching academic paper metadata from CrossRef API.

## Features

- Fetch complete metadata for any DOI
- Generate properly formatted BibTeX entries
  - Automatic title wrapping in double curly brackets `{{title}}`
  - No abstract field in BibTeX output
  - Proper line breaks and formatting
- Extract author information with full names when available
- Get journal full names and abbreviations
- Fetch paper references (when available)
- Type detection (article, book, conference paper, etc.)

## Installation & Setup

### Using Docker (Recommended)

1. Clone or create this directory structure
2. Build the Docker image:
    ```bash
    docker-compose build
    ```
3. Add to Claude Desktop configuration:
    ```json
    {
        "mcpServers": {
            "crossref": {
                "command": "docker",
                "args": ["compose", "run", "--rm", "crossref-mcp"],
                "cwd": "/path/to/crossref-mcp"
            }
        }
    }
    ```

## Available Tools
- `fetch_doi_metadata`: Fetches complete metadata for a given DOI, including:
  - Title, authors, journal information
  - Year, volume, issue, pages
  - Publisher information
  - Formatted BibTeX (without abstract, title in double curly brackets)
  - Citation counts
- `fetch_references`: Attempts to fetch references cited by the paper (when available from CrossRef).

## Usage Example
Once configured, you can use it in Claude with:

```
Use the CrossRef MCP to fetch metadata for DOI: 10.1038/nature12373
```
