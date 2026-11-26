# Where the catalog is captured, on every machine: Argos compares pixels, so the fonts a fallback
# reaches (Arabic, emoji), fontconfig's rendering and the libraries Electron draws with are pinned
# here rather than taken from whichever host runs it.
FROM node:22.23-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

# apt from the snapshot the base was built from, which its sources name, so the digest pins both.
RUN sed -i -e '/^URIs:/d' \
    -e 's|^# \(http://snapshot\.debian\.org/.*\)|URIs: \1\nCheck-Valid-Until: no|' \
    /etc/apt/sources.list.d/debian.sources \
  && grep -q '^URIs: http://snapshot' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb xauth \
    libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libxshmfence1 libdrm2 libxkbcommon0 \
    libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxrandr2 libcups2 libpango-1.0-0 \
    fonts-noto-core fonts-noto-color-emoji fontconfig \
  && rm -rf /var/lib/apt/lists/*

COPY fonts.conf /etc/fonts/local.conf

# pnpm prepared here rather than downloaded by every capture. Keep it in step with packageManager in
# the root package.json: a mismatch still works, at the cost of that download.
ARG PNPM_VERSION=10.30.3
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" \
  && chmod -R a+rwX /opt/corepack \
  && fc-cache -f
