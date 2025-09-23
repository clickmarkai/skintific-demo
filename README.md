# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/82fd1fa1-a515-415c-8e05-8e64eafaa3a8

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/82fd1fa1-a515-415c-8e05-8e64eafaa3a8) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

### Deploy to Netlify

This project is configured for Netlify:

- `netlify.toml` defines the build command and publish directory
- `public/_redirects` enables SPA routing for React Router

Steps:

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Netlify, create a New site from Git, select your repo.
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Node version: Netlify will read `NODE_VERSION` from `netlify.toml` (20)
4. Add environment variables in Netlify > Site settings > Environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_CHAT_API_URL` (frontend)
   - `VITE_OPENAI_API_KEY` (function)
   - `VITE_SUPABASE_URL` (function)
   - `VITE_SUPABASE_SERVICE_ROLE_KEY` (function)

### Netlify Functions

- Chat endpoint is deployed at `/.netlify/functions/chat`. For local dev, set:

```sh
VITE_CHAT_API_URL=/.netlify/functions/chat
```

- Optional Supabase persistence: run SQL in `supabase/schema.sql` on your project.

### Chat & AI Setup

- Set your OpenAI key:
  - Local: create `.env` with `VITE_OPENAI_API_KEY=...` and `VITE_CHAT_API_URL=/.netlify/functions/chat`.
  - Netlify: set `VITE_OPENAI_API_KEY` in Site settings > Environment variables.
- The chat UI is in `src/components/ChatWidget.tsx`. It sends requests to the value in `VITE_CHAT_API_URL` and renders rich responses (products, cart, tickets) from the function.

### Testing

Run unit tests (Vitest):

```sh
npm run test
```

Tests cover intent detection, quantity parsing, voucher and cart math.

### Troubleshooting

- If the chat UI returns no response, verify `VITE_CHAT_API_URL` is set and the Netlify Function is deployed.
- If using Supabase persistence, ensure the tables from `supabase/schema.sql` are created and the service role envs are set on Netlify.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)
#  s k i n t i f i c - d e m o

#  s k i n t i f i c - d e m o
