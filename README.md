# SuReSuite

Resilience-grade supply chain simulation platform — a React/Vite frontend over a
Supabase control plane, with simulation executed by a Python engine on a Fly.io
worker.

See [`CLAUDE.md`](CLAUDE.md) for the repo map and
[`docs/design/next-gen-platform-design.md`](docs/design/next-gen-platform-design.md)
for the governing design blueprint.

## Local development

Requires Node.js & npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
git clone <repository-url>
cd suresuite
npm ci        # this project standardizes on npm — package-lock.json is the lockfile
npm run dev   # http://localhost:8080
```

Other scripts: `npm run build` (production bundle), `npm run lint`,
`npm run preview` (serve the built bundle).

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

## Tech stack

Vite · TypeScript · React · shadcn-ui · Tailwind CSS — with Supabase (Postgres,
edge functions) as the data and control plane and a Fly.io worker for execution.

## Deployment

| Tier | Host | Deployed by |
| --- | --- | --- |
| Frontend | Vercel | push to the default branch |
| Edge functions / migrations | Supabase | `.github/workflows/supabase-functions.yml`, `supabase-migrations.yml` |
| Sim worker | Fly.io (`suresuite-sim-worker`) | `.github/workflows/deploy-sim-worker.yml` |

The frontend builds with `vite build`; Vite loads `.env.production` for every
production build, so the committed `VITE_*` flags there are the effective
settings unless overridden by a Vercel dashboard environment variable of the
same name.
