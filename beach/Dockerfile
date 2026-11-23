FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gcc git libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY beach/native ./beach/native
RUN sh beach/native/build.sh

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/beach/.build ./beach/.build
COPY beach/server.mjs beach/emulator.mjs beach/training.mjs beach/learner.mjs ./beach/
COPY beach/viewer/ ./beach/viewer/
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=8787 BEACH_DATA=/data BEACH_ROM=/rom/pokeyellow.gbc BEACH_SYMBOLS=/rom/pokeyellow.sym
USER node
EXPOSE 8787
CMD ["node", "beach/server.mjs"]
