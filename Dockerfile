# tmct's three server Lambdas — row-service, turn-service, news-worker —
# ship as one container image. The build context must already carry the
# prebuilt ESM bundles and sqlite seeds (CI runs the npm build scripts named
# in server/README.md before `docker build`; this file only COPYs their
# output, it never runs esbuild or the seed builders itself).
#
# aws-lambda-ric compiles a native addon on install (node-gyp), so the
# toolchain lives only in the builder stage; the final stage copies the
# already-built node_modules across and stays slim.

FROM node:24-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# A standalone manifest, not the repo's own package.json: the image only
# ever needs the Lambda runtime interface client plus the AWS SDK clients
# the bundles externalize (server/*/handler.mjs strip these at bundle time
# because the managed runtime used to provide them — a container does not).
# Versions match the repo's own devDependencies pin so behavior matches CI.
RUN npm init -y \
    && npm install --omit=dev \
        aws-lambda-ric@4.0.2 \
        @aws-sdk/client-dynamodb@3.1106.0 \
        @aws-sdk/lib-dynamodb@3.1106.0 \
        @aws-sdk/client-lambda@3.1106.0

FROM node:24-slim AS final

WORKDIR /var/task

COPY --from=builder /build/node_modules ./node_modules

COPY server/row-service/dist/handler.mjs ./row-service/handler.mjs
COPY server/turn-service/dist/handler.mjs ./turn-service/handler.mjs
COPY server/news-worker/dist/handler.mjs ./news-worker/handler.mjs

COPY server/seeds/mid-seed.sqlite ./seeds/mid-seed.sqlite
COPY server/seeds/xl-seed.sqlite ./seeds/xl-seed.sqlite

ENV TMCT_MID_SEED_SQLITE=/var/task/seeds/mid-seed.sqlite
ENV TMCT_XL_SEED_SQLITE=/var/task/seeds/xl-seed.sqlite

# The CDK container functions (infra/lib/website-stack.ts) override `cmd`
# per function as ["<service>/handler.handler"] against this same
# ENTRYPOINT — row-service is only the default for a bare `docker run`.
ENTRYPOINT [ "/usr/local/bin/npx", "aws-lambda-ric" ]
CMD [ "row-service/handler.handler" ]
