# Danjoo Project Dashboard

This version stores projects, tasks, owners and statuses centrally in Netlify Database. The browser talks to the database only through the Netlify Function at `/api/dashboard`; no dashboard data is stored in `localStorage`.

## Deploy to Netlify

1. Put this complete folder in a Git repository and connect that repository to a Netlify project.
2. On a Netlify credit-based plan, deploy the project. Netlify detects `@netlify/database`, provisions the managed Postgres database and applies the migration in `netlify/database/migrations`.
3. Open the production site. On its first load, the Function seeds the six sample projects and four sample tasks. Later deploys do not overwrite existing data.

For local development, install Node.js and run:

```bash
npm install
npm run dev
```

The dashboard refreshes centrally stored data every 15 seconds and whenever a browser tab becomes active again.

## Access control

The API is intentionally same-origin, but anyone who can open a public deployment can also edit its dashboard data. Before entering real client information, protect the Netlify site with your preferred Netlify access-control option or add authenticated user checks to the Function.
