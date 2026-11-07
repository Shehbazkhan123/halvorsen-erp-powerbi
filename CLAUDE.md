# PowerBI-Claude

Building Power BI reports with Claude Code and the Power BI Modeling MCP server (`powerbi-modeling`, set up in `.mcp.json`).

## Working setup
- Power BI Desktop must be open, with the target model loaded, before the MCP server can connect to it.
- Save reports in this folder as **PBIP** (Power BI Project: File > Save as > .pbip). That stores the semantic model as TMDL text files, so changes can be reviewed and versioned.
- Use the MCP tools to change the model (tables, relationships, measures, DAX). Avoid hand-editing TMDL while Desktop has the model open.

## Conventions
- Measures go in a dedicated `_Measures` table, organized into display folders.
- Give every measure a description and a format string.
- Use a marked date table. Keep relationships single-direction unless there's a documented reason not to.
