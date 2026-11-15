FROM rust:1-bookworm AS server-build
WORKDIR /app
COPY Cargo.toml Cargo.lock build.rs ./
COPY src ./src
RUN cargo build --locked --release --no-default-features --bin mines-server

FROM scratch AS server-export
COPY --from=server-build /app/target/release/mines-server /mines-server
COPY deploy/mines.service deploy/mines.env deploy/Caddyfile.native /deploy/

FROM caddy:2 AS gateway
COPY deploy/Caddyfile /etc/caddy/Caddyfile

FROM debian:bookworm-slim AS backend
RUN groupadd --gid 10001 mines && useradd --uid 10001 --gid mines mines && mkdir /data && chown mines:mines /data
COPY --from=server-build /app/target/release/mines-server /usr/local/bin/mines-server
USER mines
ENV MINES_DATA_DIR=/data MINES_BIND=0.0.0.0:3847 MINES_SECURE_COOKIE=1
EXPOSE 3847
CMD ["mines-server"]
