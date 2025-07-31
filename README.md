# Explain Explainer

A web-based tool that translates SQL EXPLAIN and EXPLAIN ANALYZE outputs from PostgreSQL and MySQL/MariaDB into plain English explanations.

## Features

- Parses PostgreSQL EXPLAIN/EXPLAIN ANALYZE text format
- Parses MySQL/MariaDB EXPLAIN/EXPLAIN ANALYZE text format  
- Translates technical execution plans into human-readable narratives
- Identifies performance bottlenecks and optimization opportunities
- Pure frontend application - no server required

## Usage

1. Paste your EXPLAIN or EXPLAIN ANALYZE output into the input area
2. The tool will automatically detect whether it's PostgreSQL or MySQL format
3. Read the plain English explanation of how your query will be executed

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deployment

To deploy to GitHub Pages manually:

1. Build the project: `npm run build`
2. Deploy the dist folder to GitHub Pages

You'll need to:
1. Go to Settings > Pages in your GitHub repository
2. Set Source to "Deploy from a branch"
3. Choose the branch where you'll push the built files

Alternatively, create a GitHub Actions workflow with the `workflow` permission to automate deployment.

## License

MIT