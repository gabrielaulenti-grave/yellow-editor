# Build the patched minigame ROM server-side from pinned public disassembly sources.
# No ROM or symbol files are committed to Git or copied into any public assets.
FROM node:24-bookworm-slim AS rom-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git make gcc g++ libc6-dev bison flex libpng-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone --depth 1 --branch v1.0.4 https://github.com/gbdev/rgbds.git rgbds \
    && make -C rgbds -j2
RUN mkdir pokeyellow && cd pokeyellow && git init \
    && git remote add origin https://github.com/pret/pokeyellow.git \
    && git fetch --depth 1 origin b452f2ab07185075140061c5084ab866d5e4a794 \
    && git checkout --detach FETCH_HEAD
COPY beach/prepare-rom.mjs /build/prepare-rom.mjs
RUN node /build/prepare-rom.mjs /build/pokeyellow \
    && make -C /build/pokeyellow RGBDS=/build/rgbds/ -j2 yellow \
    && test -s /build/pokeyellow/pokeyellow.gbc \
    && test -s /build/pokeyellow/pokeyellow.sym \
    && gzip -9 -c /build/pokeyellow/pokeyellow.gbc > /build/pokeyellow/pokeyellow.gbc.gz \
    && gzip -9 -c /build/pokeyellow/pokeyellow.sym > /build/pokeyellow/pokeyellow.sym.gz \
    && sha256sum /build/pokeyellow/pokeyellow.gbc /build/pokeyellow/pokeyellow.sym \
    && wc -c /build/pokeyellow/pokeyellow.gbc.gz /build/pokeyellow/pokeyellow.sym.gz

FROM node:24-bookworm-slim AS emulator-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gcc git libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY beach/native ./beach/native
RUN sh beach/native/build.sh

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=emulator-build /app/beach/.build ./beach/.build
COPY --from=rom-build /build/pokeyellow/pokeyellow.gbc.gz /rom/pokeyellow.gbc.gz
COPY --from=rom-build /build/pokeyellow/pokeyellow.sym.gz /rom/pokeyellow.sym.gz
COPY beach/server.mjs beach/emulator.mjs beach/training.mjs beach/learner.mjs beach/remote-checkpoint.mjs beach/video.mjs ./beach/
COPY public/beach/index.html public/beach/style.css public/beach/viewer.js ./public/beach/
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=8787 BEACH_DATA=/data BEACH_ROM=/tmp/pokeyellow.gbc BEACH_SYMBOLS=/tmp/pokeyellow.sym
USER node
EXPOSE 8787
CMD ["sh", "-ec", "gzip -dc /rom/pokeyellow.gbc.gz > /tmp/pokeyellow.gbc && gzip -dc /rom/pokeyellow.sym.gz > /tmp/pokeyellow.sym && exec node beach/server.mjs"]
