# Build context is the REPO ROOT (not sim-worker/): the scsim engine lives in
# the sibling ../scsim directory and must be baked into the image for the
# canonical experiment.run path. Build/deploy with:
#
#   flyctl deploy . --config sim-worker/fly.toml --dockerfile sim-worker/Dockerfile
#
# (CI does exactly this — see .github/workflows/deploy-sim-worker.yml.)
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY sim-worker/requirements.txt ./requirements.txt
# Non-editable install into site-packages, then drop the source tree so no
# repo-root `scsim/` directory can shadow the installed package (the same
# namespace-package hazard .github/workflows/scsim-tests.yml defends against).
COPY scsim ./scsim-src
RUN pip install -r requirements.txt ./scsim-src && rm -rf ./scsim-src

COPY sim-worker/sim_worker ./sim_worker

CMD ["python", "-m", "sim_worker"]
