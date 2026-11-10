# Build only source directories from the pinned Emumet checkout; never COPY .env.
FROM rust:1.94.1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -r /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY kernel ./kernel
COPY application ./application
COPY driver ./driver
COPY server ./server
COPY migrations ./migrations
ENV CARGO_PROFILE_DEV_DEBUG=0
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/target cargo build --locked -p server -j 4 && cp target/debug/server /server
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 ca-certificates curl && rm -r /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /server /app/server
ENV RUST_LOG=warn AWS_EC2_METADATA_DISABLED=true
CMD ["/app/server"]
