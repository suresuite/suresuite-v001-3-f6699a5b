# Welcome to your GPT Engineer project

## Project info

**URL**: https://run.gptengineer.app/projects/7e753aa5-e867-4890-ab18-f97d53f001e8/improve

## How can I edit this code?

There are several ways of editing your application.

**Use GPT Engineer**

Simply visit the GPT Engineer project at [GPT Engineer](https://gptengineer.app/projects/7e753aa5-e867-4890-ab18-f97d53f001e8/improve) and start prompting.

Changes made via gptengineer.app will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in the GPT Engineer UI.

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

## SCSIM simulation engine

The resilience-grade 3-echelon supply chain simulator lives under
[`scsim/`](scsim/README.md) — a phase-pipeline weekly DES with a 22-policy
catalog (9 strategies implemented, MTO + MTS fulfillment modes), a generalized
disruption injector, ST-1/ST-2 stress-test batteries with a Resilience
Index, CRN portfolio studies with synergy decomposition, and a statistical
engine (keyed RNG tree, MSER-5/Conway warm-up, percentile bootstrap).

```bash
pip install -e "./scsim[dev]"
python -m pytest scsim/tests -q          # golden traces, G-RNG, perf guard
python scsim/scripts/gen_docs.py --check # docs CI gate
python -m scsim.io.registry_export       # the /scsim/registry payload
```

Documentation: [`scsim/docs/`](scsim/docs/index.md) (MkDocs; the policy
catalog / variable dictionary / pipeline contract pages are generated from
the code registry). The existing Fly.io worker can run experiments on this
engine behind the `SCSIM_ENGINE=1` flag — see
[`sim-worker/README.md`](sim-worker/README.md#scsim-engine-bridge-opt-in).

## Backend API

The FastAPI backend now lives under `services/api`.

```bash
# Install dependencies
pip install -r services/api/requirements.txt

# Start the API
uvicorn services.api.main:app --reload --host 0.0.0.0 --port 8000
```

## Environment Variables

Create a `.env` file in the project root with the following values:

```
SUPABASE_URL=<your Supabase project URL>
SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>
```

These variables are required at build time and should never be committed to version control.

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

This project is built with .

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

All GPT Engineer projects can be deployed directly via the GPT Engineer app.

Simply visit your project at [GPT Engineer](https://gptengineer.app/projects/7e753aa5-e867-4890-ab18-f97d53f001e8/improve) and click on Share -> Publish.

## I want to use a custom domain - is that possible?

We don't support custom domains (yet). If you want to deploy your project under your own domain then we recommend using Netlify. Visit our docs for more details: [Custom domains](https://docs.gptengineer.app/tips-tricks/custom-domain/)
