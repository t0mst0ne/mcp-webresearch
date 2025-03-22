#!/usr/bin/env node

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Import necessary modules
const { Command } = require('commander');
const { chromium } = require('playwright');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

// Declare variables for global use
let browser;
let page;
const results = [];
const app = express();
const port = 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the schema for the tool request
const CallToolRequestSchema = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        arguments: { type: 'object' },
    },
    required: ['name', 'arguments'],
};

// Function to ensure the browser is initialized
async function ensureBrowser() {
    if (!browser) {
        browser = await chromium.launch({
            headless: 'new', // Use the new headless mode
        });
    }
    if (!page) {
        page = await browser.newPage();
    }
    return page;
}

// Function to safely navigate to a URL
async function safePageNavigation(page, url) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
        console.error(`Navigation to ${url} failed:`, error);
        throw error; // Re-throw the error to be caught by the caller
    }
}

// Function to add results
function addResult(result) {
    results.push(result);
}

// Function to perform a Google search
async function performGoogleSearch(query) {
    const page = await ensureBrowser();
    await safePageNavigation(page, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    const searchResults = await page.evaluate(() => {
        const results = Array.from(document.querySelectorAll('.tF2Cxc')).map((el) => {
            const titleEl = el.querySelector('.LC20lb');
            const urlEl = el.querySelector('.yuRUbf > a');
            const snippetEl = el.querySelector('.VwiCzo');
            return {
                title: titleEl?.textContent || '',
                url: urlEl?.href || '',
                snippet: snippetEl?.textContent || '',
            };
        });
        return searchResults;
    });

    searchResults.forEach((result) => {
        addResult({
            type: 'google',
            ...result,
            timestamp: new Date().toISOString(),
        });
    });

    return searchResults;
}

// Function to perform a DuckDuckGo search
async function performDuckDuckGoSearch(query) {
    const page = await ensureBrowser();
    await safePageNavigation(page, `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);

    const results = await page.evaluate(() => {
        const resultsSelector = '.results_wrapper .web-results .result';
        return Array.from(document.querySelectorAll(resultsSelector)).map((el) => {
            const titleEl = el.querySelector('a.result__a');
            const urlEl = el.querySelector('a.result__a');
            const snippetEl = el.querySelector('.result__snippet');

            return {
                title: titleEl?.textContent.trim() || '',
                url: urlEl?.href || '',
                snippet: snippetEl?.textContent.trim() || '',
            };
        });
    });

    results.forEach((result) => {
        addResult({
            type: 'duckduckgo',
            ...result,
            timestamp: new Date().toISOString(),
        });
    });

    return results;
}

// Function to perform a YouTube search
async function performYouTubeSearch(query) {
    const page = await ensureBrowser();
    await safePageNavigation(page, `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);

    const results = await page.evaluate(() => {
        const resultsSelector = '#contents ytd-item-section-renderer > div > ytd-video-renderer';
        return Array.from(document.querySelectorAll(resultsSelector)).map((el) => {
            const titleEl = el.querySelector('#video-title');
            const url = el.querySelector('#video-title')?.getAttribute('href');
            const snippetEl = el.querySelector('#description-text');

            return {
                title: titleEl?.textContent.trim() || '',
                url: url ? `https://www.youtube.com${url}` : '',
                snippet: snippetEl?.textContent.trim() || '',
            };
        });
    });

    results.forEach((result) => {
        addResult({
            type: 'youtube',
            ...result,
            timestamp: new Date().toISOString(),
        });
    });
    return results;
}

// Function to perform a PubMed search
async function performPubMedSearch(query) {
    const page = await ensureBrowser();
    const specificSearchTerms = '("Randomized controlled trial"[Publication Type] OR "Meta-Analysis"[Publication Type] OR "Review"[Publication Type])';
    const fullQuery = `${query} AND ${specificSearchTerms}`;
    await safePageNavigation(page, `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(fullQuery)}`);

    const pubmedResults = await page.evaluate(() => {
        const elements = document.querySelectorAll('.pubmed-citation-list > .pubmed-citation');
        return Array.from(elements).map((el) => {
            const titleEl = el.querySelector('.docsum-title');
            const linkEl = el.querySelector('.docsum-title > a');
            const authorsEl = el.querySelector('.docsum-authors');
            const journalEl = el.querySelector('.docsum-journal');
            const snippetEl = el.querySelector('.full-citation');

            return {
                title: titleEl?.textContent?.trim() || '',
                url: linkEl?.getAttribute('href') ? `https://pubmed.ncbi.nlm.nih.gov${linkEl.getAttribute('href')}` : '',
                authors: authorsEl?.textContent?.trim() || '',
                journal: journalEl?.textContent?.trim() || '',
                snippet: snippetEl?.textContent?.trim() || '',
            };
        });
    });

    pubmedResults.forEach((result) => {
        addResult({
            type: 'pubmed',
            ...result,
            timestamp: new Date().toISOString(),
        });
    });
    return pubmedResults;
}

// Function to retry operations
async function withRetry(operation, maxRetries = 3, delay = 1000) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await operation();
        } catch (error) {
            attempt++;
            if (attempt === maxRetries) {
                throw error; // Re-throw the error after max retries
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
            console.warn(`Attempt ${attempt} failed, retrying...`);
        }
    }
    throw new Error("Max retries reached"); // Ensure an error is thrown if all retries fail
}

// Tool request handler for executing research operations
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
    // Initialize browser for tool operations
    const page = await ensureBrowser();

    switch (request.params.name) {
        case 'search_google': {
            const { query } = request.params.arguments as { query: string };
            try {
                const results = await withRetry(() => performGoogleSearch(query));
                return {
                    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                };
            } catch (error) {
                return {
                    content: [{ type: 'text', text: `Failed to perform Google search: ${(error as Error).message}` }],
                    isError: true,
                };
            }
        }
        case 'search_duckduckgo': {
            const { query } = request.params.arguments as { query: string };
            try {
                const results = await withRetry(() => performDuckDuckGoSearch(query));
                return {
                    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                };
            } catch (error) {
                return {
                    content: [{ type: 'text', text: `Failed to perform DuckDuckGo search: ${(error as Error).message}` }],
                    isError: true,
                };
            }
        }
        case 'search_youtube': {
            const { query } = request.params.arguments as { query: string };
            try {
                const results = await withRetry(() => performYouTubeSearch(query));
                return {
                    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                };
            } catch (error) {
                return {
                    content: [{ type: 'text', text: `Failed to perform YouTube search: ${(error as Error).message}` }],
                    isError: true,
                };
            }
        }
        case 'search_pubmed': {
            const { query } = request.params.arguments as { query: string };
            try {
                const results = await withRetry(() => performPubMedSearch(query));
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(results, null, 2),
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: 'text',
                        text: `Failed to perform PubMed search: ${(error as Error).message}`,
                    }],
                    isError: true,
                };
            }
        }
        default:
            return {
                content: [{ type: 'text', text: `Tool ${request.params.name} not found` }],
                isError: true,
            };
    }
});

// Express server setup
app.use(cors());
app.use(bodyParser.json());

// Endpoint to handle search requests
app.post('/search', async (req, res) => {
    const { query, engine } = req.body;

    if (!query || !engine) {
        return res.status(400).json({ error: 'Query and engine are required' });
    }

    results.length = 0; // Clear previous results

    try {
        let searchResults;
        switch (engine) {
            case 'google':
                searchResults = await performGoogleSearch(query);
                break;
            case 'duckduckgo':
                searchResults = await performDuckDuckGoSearch(query);
                break;
            case 'youtube':
                searchResults = await performYouTubeSearch(query);
                break;
            case 'pubmed':
                searchResults = await performPubMedSearch(query);
                break;
            default:
                return res.status(400).json({ error: 'Invalid search engine' });
        }

        // Create a unique ID for the response
        const responseId = uuidv4();

        // Construct the data object
        const data = {
            id: responseId,
            query,
            engine,
            results,
        };

        // Define the file path
        const filePath = path.join(__dirname, 'search_results.json');

        // Convert the data object to a JSON string
        const jsonData = JSON.stringify(data, null, 2);

        // Write the JSON string to the file
        fs.writeFile(filePath, jsonData, 'utf8', (err) => {
            if (err) {
                console.error('Error writing to file:', err);
                return res.status(500).json({ error: 'Failed to write search results to file' });
            }
            console.log('Search results written to file successfully');
        });

        // Send the response back to the client
        res.json({
            id: responseId,
            query,
            engine,
            results,
        });
    } catch (error) {
        console.error('Search failed:', error);
        res.status(500).json({ error: 'Search failed', message: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Handle program termination
process.on('SIGINT', async () => {
    console.log('Closing browser...');
    if (browser) {
        await browser.close();
    }
    console.log('Exiting...');
    process.exit();
});

// For tests
export { performGoogleSearch, performDuckDuckGoSearch, performYouTubeSearch, performPubMedSearch, CallToolRequestSchema, server };
