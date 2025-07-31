# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Explain Explainer is a web-based tool that parses SQL EXPLAIN/EXPLAIN ANALYZE outputs from PostgreSQL and MySQL/MariaDB and translates them into plain English explanations.

## Development Commands

- `npm run dev` - Start development server on http://localhost:5173
- `npm run build` - Build for production (TypeScript check + Vite build)
- `npm run typecheck` - Run TypeScript type checking only
- `npm run preview` - Preview production build locally

## Architecture

The project follows a modular TypeScript architecture:

- **Parser Module** (`src/parser/`): Contains database-specific parsers
  - `postgres-parser.ts`: Parses PostgreSQL EXPLAIN text format
  - `mysql-parser.ts`: Parses MySQL/MariaDB EXPLAIN text format
  - `parser-types.ts`: Shared types for parsed execution plans

- **Translator Module** (`src/translator/`): Converts parsed plans to English
  - `translator.ts`: Main translation logic
  - `explanations.ts`: Template strings and explanation builders

- **UI Module** (`src/ui/`): Frontend interface
  - `app.ts`: Main application logic and event handling

## Key Implementation Details

1. **Parser Strategy**: Use indentation levels (PostgreSQL) or arrow prefixes (MySQL) to build tree structures
2. **Auto-detection**: Identify database type by looking for characteristic patterns (e.g., "->", "cost=", "actual time=")
3. **Translation Flow**: Parse → Build AST → Generate narrative following execution order
4. **Performance Focus**: Highlight slow operations, missing indexes, and optimization opportunities

## Testing

Test with real-world EXPLAIN outputs, especially:
- Complex joins with multiple tables
- Parallel query execution (PostgreSQL)
- Queries with performance issues
- Both EXPLAIN and EXPLAIN ANALYZE formats