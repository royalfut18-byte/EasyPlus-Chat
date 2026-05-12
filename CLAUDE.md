# EasyPlus Project Memory

## Project Overview
EasyPlus is an AI-powered chat/application project. The goal is to build a polished, production-ready web app with persistent chat, clean UI, working API integration, and reliable deployment.

## Current Setup
- Project folder: EasyPlus
- Platform: Windows PowerShell
- Main workflow: Claude Code in terminal
- Deployment target may be Vercel unless changed
- API provider/key may change, so do not hardcode secrets into frontend or committed files

## Important Rules
- Never expose API keys in client-side code.
- Never commit `.env`, `.env.local`, or secret keys.
- Use environment variables for API keys.
- Before making big edits, inspect the existing file structure first.
- Keep existing working features unless specifically asked to replace them.
- Prefer small, safe, testable changes over huge rewrites.
- After edits, run the correct build/test command and fix errors.
- Preserve persistent chat/session behaviour. Do not reset chat on tab switch or refresh unless the user asks.
- Make the UI polished, modern, clean, rounded, responsive, and not plain.
- Explain exact commands for Windows PowerShell when setup is needed.

## API Rules
- The API key should be read from environment variables.
- If changing API providers, update only the server/backend API layer unless frontend changes are required.
- Do not duplicate provider logic across many files.
- Add clear error handling for failed API calls.
- If a model/API call fails, show a useful error instead of crashing the app.

## Commands
Before assuming commands, inspect package.json.
Usually:
- Install: npm install
- Dev: npm run dev
- Build: npm run build

## User Preference
The user wants direct, copy-pasteable commands and practical fixes, not vague theory.
